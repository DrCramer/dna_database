const express = require('express');
const router = express.Router();
const { logger } = require('../utils/logger');
const { query } = require('../config/database');

// Dashboard data endpoint
router.get('/', async (req, res) => {
    try {
        // Get user info (assuming admin for now)
        const user = {
            id: 1,
            username: 'admin',
            role: 'admin',
            organization_id: 1
        };

        // Get statistics from database
        const stats = {};

        try {
            // Get DNA profiles count
            const profilesResult = await query('SELECT COUNT(*) as count FROM dna_profiles');
            stats.totalProfiles = parseInt(profilesResult.rows[0].count) || 0;

            // Get staff profiles count
            const staffResult = await query('SELECT COUNT(*) as count FROM staff_profiles');
            stats.staffProfiles = parseInt(staffResult.rows[0].count) || 0;

            // Get users count
            const usersResult = await query('SELECT COUNT(*) as count FROM users');
            stats.totalUsers = parseInt(usersResult.rows[0].count) || 0;

            // Get recent profiles (last 30 days)
            const recentResult = await query(`
                SELECT COUNT(*) as count 
                FROM dna_profiles 
                WHERE upload_date >= NOW() - INTERVAL '30 days'
            `);
            stats.recentProfiles = parseInt(recentResult.rows[0].count) || 0;

        } catch (dbError) {
            logger.warn('Failed to get some dashboard statistics:', dbError.message);
            // Set default values if database queries fail
            stats.totalProfiles = 0;
            stats.staffProfiles = 0;
            stats.totalUsers = 0;
            stats.recentProfiles = 0;
        }

        // Return dashboard data
        res.json({
            user,
            stats,
            features: {
                upload: true,
                analysis: true,
                search: true,
                export: true,
                bayesian: true
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Dashboard error:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to load dashboard data'
        });
    }
});

module.exports = router;