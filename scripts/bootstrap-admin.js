#!/usr/bin/env node

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

async function main() {
    const password = process.env.ADMIN_PASSWORD;
    if (!password || password.length < 16) {
        throw new Error('ADMIN_PASSWORD must contain at least 16 characters');
    }

    const pool = new Pool({
        host: process.env.DB_HOST || 'db',
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME || 'dna_analysis',
        user: process.env.DB_USER || 'dna_user',
        password: process.env.DB_PASSWORD
    });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const users = await client.query('SELECT COUNT(*)::int AS count FROM users');
        if (users.rows[0].count !== 0) {
            await client.query('ROLLBACK');
            console.log('Users already exist; administrator bootstrap skipped.');
            return;
        }

        const organization = await client.query(
            `INSERT INTO organizations (name, description)
             VALUES ($1, $2)
             ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            ['СМЭ', 'Судебно-медицинская экспертиза']
        );
        const organizationId = organization.rows[0].id;
        const departments = [
            ['ЧС', 'Чрезвычайные ситуации'],
            ['Генетические экспертизы', 'Отдел генетических экспертиз']
        ];
        let adminDepartmentId;
        for (const [name, description] of departments) {
            const department = await client.query(
                `INSERT INTO departments (organization_id, name, description)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (organization_id, name) DO UPDATE SET name = EXCLUDED.name
                 RETURNING id`,
                [organizationId, name, description]
            );
            adminDepartmentId ||= department.rows[0].id;
        }

        const passwordHash = await bcrypt.hash(password, 12);
        await client.query(
            `INSERT INTO users (organization_id, department_id, username, email, password_hash, role, is_active)
             VALUES ($1, $2, 'admin', 'admin@sme.local', $3, 'admin', true)`,
            [organizationId, adminDepartmentId, passwordHash]
        );
        await client.query('COMMIT');
        console.log('Administrator and organization created.');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(error => {
    console.error(`Bootstrap failed: ${error.message}`);
    process.exitCode = 1;
});
