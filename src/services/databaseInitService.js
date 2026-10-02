const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');
const { query, transaction, connectDatabase } = require('../config/database');
const { logger } = require('../utils/logger');

class DatabaseInitService {
    constructor() {
        this.initializationSteps = [
            { name: 'connection', fn: this.verifyConnection.bind(this) },
            { name: 'extensions', fn: this.createExtensions.bind(this) },
            // { name: 'schema', fn: this.initializeSchema.bind(this) }, // Temporarily disabled
            // { name: 'migrations', fn: this.runMigrations.bind(this) }, // Temporarily disabled
            { name: 'indexes', fn: this.verifyIndexes.bind(this) },
            { name: 'constraints', fn: this.verifyConstraints.bind(this) },
            // { name: 'data', fn: this.seedInitialData.bind(this) } // Temporarily disabled
        ];
    }

    async initialize() {
        logger.info('Starting database initialization...');
        const startTime = Date.now();
        const results = {};

        try {
            for (const step of this.initializationSteps) {
                logger.info(`Executing initialization step: ${step.name}`);
                const stepStart = Date.now();
                
                try {
                    const result = await step.fn();
                    results[step.name] = {
                        status: 'success',
                        duration: Date.now() - stepStart,
                        ...result
                    };
                    logger.info(`Step ${step.name} completed successfully`);
                } catch (error) {
                    results[step.name] = {
                        status: 'error',
                        duration: Date.now() - stepStart,
                        error: error.message
                    };
                    logger.error(`Step ${step.name} failed:`, error);
                    throw error;
                }
            }

            const totalDuration = Date.now() - startTime;
            logger.info(`Database initialization completed successfully in ${totalDuration}ms`);
            
            return {
                status: 'success',
                duration: totalDuration,
                steps: results
            };

        } catch (error) {
            const totalDuration = Date.now() - startTime;
            logger.error(`Database initialization failed after ${totalDuration}ms:`, error);
            
            return {
                status: 'error',
                duration: totalDuration,
                error: error.message,
                steps: results
            };
        }
    }

    async verifyConnection() {
        try {
            await connectDatabase();
            const result = await query('SELECT version() as version, current_database() as database');
            
            return {
                database: result.rows[0].database,
                version: result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1]
            };
        } catch (error) {
            throw new Error(`Database connection failed: ${error.message}`);
        }
    }

    async createExtensions() {
        const extensions = ['pgcrypto'];
        const results = {};

        for (const extension of extensions) {
            try {
                await query(`CREATE EXTENSION IF NOT EXISTS "${extension}"`);
                results[extension] = 'created';
            } catch (error) {
                logger.warn(`Failed to create extension ${extension}:`, error.message);
                results[extension] = 'failed';
            }
        }

        return { extensions: results };
    }

    async initializeSchema() {
        try {
            const initSqlPath = path.join(__dirname, '../../database/init.sql');
            const initSql = await fs.readFile(initSqlPath, 'utf8');
            
            // Execute schema creation in a transaction
            await transaction(async (client) => {
                const statements = this.parseSqlStatements(initSql);
                let executedCount = 0;
                
                for (const statement of statements) {
                    if (statement.trim()) {
                        try {
                            await client.query(statement);
                            executedCount++;
                        } catch (error) {
                            // Ignore "already exists" errors
                            if (!error.message.includes('already exists') && 
                                !error.message.includes('duplicate key')) {
                                throw error;
                            }
                        }
                    }
                }
                
                return { statementsExecuted: executedCount };
            });

            return { schemaInitialized: true };
        } catch (error) {
            throw new Error(`Schema initialization failed: ${error.message}`);
        }
    }

    async runMigrations() {
        try {
            const migrationsDir = path.join(__dirname, '../../database/migrations');
            let migrationFiles = [];
            
            try {
                const files = await fs.readdir(migrationsDir);
                migrationFiles = files
                    .filter(file => file.endsWith('.sql'))
                    .sort();
            } catch (error) {
                // Migrations directory doesn't exist or is empty
                return { migrationsRun: 0 };
            }

            let migrationsRun = 0;
            
            for (const file of migrationFiles) {
                logger.info(`Running migration: ${file}`);
                const migrationPath = path.join(migrationsDir, file);
                const migrationSql = await fs.readFile(migrationPath, 'utf8');
                
                await transaction(async (client) => {
                    const statements = this.parseSqlStatements(migrationSql);
                    
                    for (const statement of statements) {
                        if (statement.trim()) {
                            try {
                                await client.query(statement);
                            } catch (error) {
                                if (!error.message.includes('already exists') && 
                                    !error.message.includes('duplicate key')) {
                                    throw error;
                                }
                            }
                        }
                    }
                });
                
                migrationsRun++;
            }

            return { migrationsRun };
        } catch (error) {
            throw new Error(`Migration execution failed: ${error.message}`);
        }
    }

    async verifyIndexes() {
        const expectedIndexes = [
            'idx_dna_profiles_user_id',
            'idx_dna_profiles_sample_name',
            'idx_match_results_profiles',
            'idx_operation_history_user_timestamp',
            'idx_user_sessions_user_id'
        ];

        try {
            const indexQuery = `
                SELECT indexname 
                FROM pg_indexes 
                WHERE schemaname = 'public' 
                AND indexname = ANY($1)
            `;
            
            const result = await query(indexQuery, [expectedIndexes]);
            const existingIndexes = result.rows.map(row => row.indexname);
            const missingIndexes = expectedIndexes.filter(idx => !existingIndexes.includes(idx));

            return {
                totalExpected: expectedIndexes.length,
                existing: existingIndexes.length,
                missing: missingIndexes
            };
        } catch (error) {
            throw new Error(`Index verification failed: ${error.message}`);
        }
    }

    async verifyConstraints() {
        try {
            const constraintQuery = `
                SELECT 
                    tc.table_name,
                    tc.constraint_name,
                    tc.constraint_type
                FROM information_schema.table_constraints tc
                WHERE tc.table_schema = 'public'
                AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY', 'CHECK', 'UNIQUE')
                ORDER BY tc.table_name, tc.constraint_type
            `;
            
            const result = await query(constraintQuery);
            const constraints = result.rows.reduce((acc, row) => {
                if (!acc[row.table_name]) {
                    acc[row.table_name] = {};
                }
                if (!acc[row.table_name][row.constraint_type]) {
                    acc[row.table_name][row.constraint_type] = 0;
                }
                acc[row.table_name][row.constraint_type]++;
                return acc;
            }, {});

            return { constraints };
        } catch (error) {
            throw new Error(`Constraint verification failed: ${error.message}`);
        }
    }

    async seedInitialData() {
        try {
            // Check if admin user exists
            const adminCheck = await query(
                'SELECT id FROM users WHERE username = $1',
                ['admin']
            );

            let adminCreated = false;
            if (adminCheck.rows.length === 0) {
                const adminPassword = process.env.ADMIN_PASSWORD;
                if (!adminPassword || adminPassword.length < 12) {
                    throw new Error('ADMIN_PASSWORD must contain at least 12 characters to seed an admin user');
                }
                const passwordHash = await bcrypt.hash(adminPassword, 12);
                await query(`
                    INSERT INTO users (username, email, password_hash, role) 
                    VALUES ($1, $2, $3, $4)
                `, [
                    'admin',
                    'admin@dna-analysis.local',
                    passwordHash,
                    'admin'
                ]);
                adminCreated = true;
            }

            // Check STR loci configuration
            const strLociCheck = await query('SELECT COUNT(*) as count FROM str_loci_config');
            const strLociCount = parseInt(strLociCheck.rows[0].count);

            return {
                adminUserCreated: adminCreated,
                strLociConfigured: strLociCount
            };
        } catch (error) {
            throw new Error(`Initial data seeding failed: ${error.message}`);
        }
    }

    parseSqlStatements(sql) {
        // Split SQL by semicolons, but be careful about semicolons in strings
        const statements = [];
        let current = '';
        let inString = false;
        let stringChar = null;
        
        for (let i = 0; i < sql.length; i++) {
            const char = sql[i];
            const prevChar = i > 0 ? sql[i - 1] : null;
            
            if (!inString && (char === "'" || char === '"')) {
                inString = true;
                stringChar = char;
            } else if (inString && char === stringChar && prevChar !== '\\') {
                inString = false;
                stringChar = null;
            } else if (!inString && char === ';') {
                if (current.trim()) {
                    statements.push(current.trim());
                }
                current = '';
                continue;
            }
            
            current += char;
        }
        
        if (current.trim()) {
            statements.push(current.trim());
        }
        
        return statements.filter(stmt => 
            stmt && 
            !stmt.startsWith('--') && 
            stmt !== ';'
        );
    }

    async getInitializationStatus() {
        try {
            const checks = {
                connection: false,
                schema: false,
                data: false
            };

            // Check connection
            try {
                await query('SELECT 1');
                checks.connection = true;
            } catch (error) {
                return { status: 'not_initialized', checks, error: 'Database connection failed' };
            }

            // Check schema
            try {
                const tableResult = await query(`
                    SELECT COUNT(*) as count 
                    FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name IN ('users', 'dna_profiles', 'match_results')
                `);
                checks.schema = parseInt(tableResult.rows[0].count) >= 3;
            } catch (error) {
                checks.schema = false;
            }

            // Check initial data
            try {
                const userResult = await query('SELECT COUNT(*) as count FROM users');
                const strResult = await query('SELECT COUNT(*) as count FROM str_loci_config');
                checks.data = parseInt(userResult.rows[0].count) > 0 && parseInt(strResult.rows[0].count) > 0;
            } catch (error) {
                checks.data = false;
            }

            const allInitialized = Object.values(checks).every(check => check === true);
            
            return {
                status: allInitialized ? 'initialized' : 'partial',
                checks
            };
        } catch (error) {
            return {
                status: 'error',
                error: error.message
            };
        }
    }
}

module.exports = new DatabaseInitService();
