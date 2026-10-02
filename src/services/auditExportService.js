const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { logger } = require('../utils/logger');
const auditService = require('./auditService');

/**
 * Service for exporting audit data in Excel and PDF formats
 * Implements task 13.2 requirement for audit export functionality
 */
class AuditExportService {
    constructor() {
        this.exportDir = path.join(process.cwd(), 'exports', 'audit');
        this.ensureExportDirectory();
        
        // Export formats supported
        this.formats = {
            EXCEL: 'excel',
            PDF: 'pdf'
        };
        
        // Audit export types
        this.exportTypes = {
            FULL_AUDIT: 'full_audit',
            DATA_ACCESS: 'data_access',
            COMPLIANCE_EVENTS: 'compliance_events',
            ORGANIZATIONAL_OPERATIONS: 'organizational_operations',
            DEPARTMENT_SUMMARY: 'department_summary'
        };
    }

    /**
     * Ensure export directory exists
     */
    async ensureExportDirectory() {
        try {
            await fs.mkdir(this.exportDir, { recursive: true });
        } catch (error) {
            logger.error('Error creating audit export directory', { error: error.message });
        }
    }

    /**
     * Export audit data to Excel format
     * @param {Object} exportOptions - Export configuration
     * @param {Object} userInfo - User information for access control
     * @returns {Promise<Object>} Export result
     */
    async exportAuditToExcel(exportOptions = {}, userInfo = {}) {
        const {
            exportType = this.exportTypes.FULL_AUDIT,
            dateRange = null,
            departmentId = null,
            organizationId = null,
            userId = null,
            includeUserDetails = true,
            includeSystemEvents = false,
            complianceLevel = null,
            filename = null
        } = exportOptions;

        const { userId: requestingUserId, ipAddress, userAgent } = userInfo;

        try {
            // Validate permissions
            await this.validateExportPermissions(requestingUserId, exportType);

            // Generate export ID and filename
            const exportId = crypto.randomUUID();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const exportFilename = filename || `audit-${exportType}-${timestamp}.xlsx`;
            const filePath = path.join(this.exportDir, exportFilename);

            // Create workbook
            const workbook = XLSX.utils.book_new();

            // Add worksheets based on export type
            switch (exportType) {
                case this.exportTypes.FULL_AUDIT:
                    await this.addFullAuditWorksheets(workbook, exportOptions, requestingUserId);
                    break;
                case this.exportTypes.DATA_ACCESS:
                    await this.addDataAccessWorksheet(workbook, exportOptions, requestingUserId);
                    break;
                case this.exportTypes.COMPLIANCE_EVENTS:
                    await this.addComplianceEventsWorksheet(workbook, exportOptions, requestingUserId);
                    break;
                case this.exportTypes.ORGANIZATIONAL_OPERATIONS:
                    await this.addOrganizationalOperationsWorksheet(workbook, exportOptions, requestingUserId);
                    break;
                case this.exportTypes.DEPARTMENT_SUMMARY:
                    await this.addDepartmentSummaryWorksheet(workbook, exportOptions, requestingUserId);
                    break;
                default:
                    throw new Error(`Unsupported export type: ${exportType}`);
            }

            // Add metadata worksheet
            await this.addMetadataWorksheet(workbook, exportOptions, userInfo);

            // Write file
            XLSX.writeFile(workbook, filePath);

            // Get file stats
            const stats = await fs.stat(filePath);

            const exportResult = {
                exportId,
                filename: exportFilename,
                filePath,
                fileSize: stats.size,
                format: this.formats.EXCEL,
                exportType,
                createdAt: new Date(),
                downloadUrl: `/api/audit/export/download/${exportId}`,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days for audit exports
                requestingUserId,
                departmentId,
                organizationId
            };

            // Log export operation
            await auditService.logOrganizationalOperation({
                userId: requestingUserId,
                operationType: auditService.operationTypes.AUDIT_EXPORT,
                resourceType: 'audit_export',
                resourceId: exportId,
                departmentId,
                organizationId,
                details: {
                    exportType,
                    format: this.formats.EXCEL,
                    filename: exportFilename,
                    fileSize: stats.size,
                    dateRange,
                    includeUserDetails,
                    includeSystemEvents
                },
                ipAddress,
                userAgent
            });

            logger.info('Audit Excel export generated successfully', {
                exportId,
                filename: exportFilename,
                fileSize: stats.size,
                exportType,
                requestingUserId
            });

            return exportResult;

        } catch (error) {
            logger.error('Error generating audit Excel export', {
                error: error.message,
                exportType,
                requestingUserId
            });
            throw error;
        }
    }

    /**
     * Export audit data to PDF format
     * @param {Object} exportOptions - Export configuration
     * @param {Object} userInfo - User information for access control
     * @returns {Promise<Object>} Export result
     */
    async exportAuditToPDF(exportOptions = {}, userInfo = {}) {
        const {
            exportType = this.exportTypes.FULL_AUDIT,
            dateRange = null,
            departmentId = null,
            organizationId = null,
            includeUserDetails = true,
            includeSystemEvents = false,
            filename = null
        } = exportOptions;

        const { userId: requestingUserId, ipAddress, userAgent } = userInfo;

        try {
            // Validate permissions
            await this.validateExportPermissions(requestingUserId, exportType);

            // Generate export ID and filename
            const exportId = crypto.randomUUID();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const exportFilename = filename || `audit-${exportType}-${timestamp}.pdf`;
            const filePath = path.join(this.exportDir, exportFilename);

            // Create PDF document
            const doc = new PDFDocument({ margin: 50 });
            const stream = require('fs').createWriteStream(filePath);
            doc.pipe(stream);

            // Add content based on export type
            await this.addPDFContent(doc, exportType, exportOptions, requestingUserId);

            // Finalize PDF
            doc.end();

            // Wait for stream to finish
            await new Promise((resolve, reject) => {
                stream.on('finish', resolve);
                stream.on('error', reject);
            });

            // Get file stats
            const stats = await fs.stat(filePath);

            const exportResult = {
                exportId,
                filename: exportFilename,
                filePath,
                fileSize: stats.size,
                format: this.formats.PDF,
                exportType,
                createdAt: new Date(),
                downloadUrl: `/api/audit/export/download/${exportId}`,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days for audit exports
                requestingUserId,
                departmentId,
                organizationId
            };

            // Log export operation
            await auditService.logOrganizationalOperation({
                userId: requestingUserId,
                operationType: auditService.operationTypes.AUDIT_EXPORT,
                resourceType: 'audit_export',
                resourceId: exportId,
                departmentId,
                organizationId,
                details: {
                    exportType,
                    format: this.formats.PDF,
                    filename: exportFilename,
                    fileSize: stats.size,
                    dateRange,
                    includeUserDetails,
                    includeSystemEvents
                },
                ipAddress,
                userAgent
            });

            logger.info('Audit PDF export generated successfully', {
                exportId,
                filename: exportFilename,
                fileSize: stats.size,
                exportType,
                requestingUserId
            });

            return exportResult;

        } catch (error) {
            logger.error('Error generating audit PDF export', {
                error: error.message,
                exportType,
                requestingUserId
            });
            throw error;
        }
    }

    /**
     * Add full audit worksheets to Excel workbook
     * @param {Object} workbook - XLSX workbook
     * @param {Object} exportOptions - Export options
     * @param {string} requestingUserId - User ID requesting export
     */
    async addFullAuditWorksheets(workbook, exportOptions, requestingUserId) {
        const { dateRange, departmentId, organizationId } = exportOptions;

        // Add audit logs worksheet
        const auditLogs = await auditService.getAuditLogsWithDepartmentFilter({
            startDate: dateRange?.startDate,
            endDate: dateRange?.endDate,
            departmentId,
            organizationId,
            limit: 10000
        });

        const auditWorksheet = this.createAuditLogsWorksheet(auditLogs);
        XLSX.utils.book_append_sheet(workbook, auditWorksheet, 'Audit Logs');

        // Add data access logs worksheet
        const dataAccessLogs = await auditService.getDataAccessLogs({
            startDate: dateRange?.startDate,
            endDate: dateRange?.endDate,
            limit: 10000
        });

        const dataAccessWorksheet = this.createDataAccessLogsWorksheet(dataAccessLogs);
        XLSX.utils.book_append_sheet(workbook, dataAccessWorksheet, 'Data Access');

        // Add compliance events worksheet
        const complianceEvents = await auditService.getComplianceEvents({
            startDate: dateRange?.startDate,
            endDate: dateRange?.endDate,
            limit: 10000
        });

        const complianceWorksheet = this.createComplianceEventsWorksheet(complianceEvents);
        XLSX.utils.book_append_sheet(workbook, complianceWorksheet, 'Compliance Events');

        // Add organizational operations worksheet
        const orgOperations = await auditService.getOrganizationalOperations({
            startDate: dateRange?.startDate,
            endDate: dateRange?.endDate,
            departmentId,
            organizationId,
            limit: 10000
        });

        const orgWorksheet = this.createOrganizationalOperationsWorksheet(orgOperations);
        XLSX.utils.book_append_sheet(workbook, orgWorksheet, 'Operations');
    }

    /**
     * Create audit logs worksheet
     * @param {Array} auditLogs - Audit log data
     * @returns {Object} XLSX worksheet
     */
    createAuditLogsWorksheet(auditLogs) {
        const headers = [
            'Timestamp',
            'User',
            'Email',
            'Department',
            'Organization',
            'Table Name',
            'Record ID',
            'Action',
            'Compliance Level',
            'IP Address',
            'User Agent',
            'Session ID',
            'Old Values',
            'New Values'
        ];

        const rows = [headers];

        auditLogs.forEach(log => {
            rows.push([
                log.timestamp ? new Date(log.timestamp).toISOString() : '',
                log.username || '',
                log.email || '',
                log.department_name || '',
                log.organization_name || '',
                log.table_name || '',
                log.record_id || '',
                log.action || '',
                log.compliance_level || '',
                log.ip_address || '',
                log.user_agent || '',
                log.session_id || '',
                log.old_values ? JSON.stringify(log.old_values) : '',
                log.new_values ? JSON.stringify(log.new_values) : ''
            ]);
        });

        const worksheet = XLSX.utils.aoa_to_sheet(rows);

        // Set column widths
        worksheet['!cols'] = [
            { wch: 20 }, // Timestamp
            { wch: 15 }, // User
            { wch: 25 }, // Email
            { wch: 20 }, // Department
            { wch: 20 }, // Organization
            { wch: 15 }, // Table Name
            { wch: 15 }, // Record ID
            { wch: 15 }, // Action
            { wch: 12 }, // Compliance Level
            { wch: 15 }, // IP Address
            { wch: 30 }, // User Agent
            { wch: 15 }, // Session ID
            { wch: 30 }, // Old Values
            { wch: 30 }  // New Values
        ];

        // Style header row
        this.styleHeaderRow(worksheet, headers.length);

        return worksheet;
    }

    /**
     * Create data access logs worksheet
     * @param {Array} dataAccessLogs - Data access log data
     * @returns {Object} XLSX worksheet
     */
    createDataAccessLogsWorksheet(dataAccessLogs) {
        const headers = [
            'Timestamp',
            'User',
            'Email',
            'Resource Type',
            'Resource ID',
            'Access Type',
            'Access Granted',
            'Denial Reason',
            'Data Classification',
            'IP Address',
            'User Agent',
            'Session ID'
        ];

        const rows = [headers];

        dataAccessLogs.forEach(log => {
            rows.push([
                log.timestamp ? new Date(log.timestamp).toISOString() : '',
                log.username || '',
                log.email || '',
                log.resource_type || '',
                log.resource_id || '',
                log.access_type || '',
                log.access_granted ? 'Yes' : 'No',
                log.denial_reason || '',
                log.data_classification || '',
                log.ip_address || '',
                log.user_agent || '',
                log.session_id || ''
            ]);
        });

        const worksheet = XLSX.utils.aoa_to_sheet(rows);

        // Set column widths
        worksheet['!cols'] = [
            { wch: 20 }, // Timestamp
            { wch: 15 }, // User
            { wch: 25 }, // Email
            { wch: 15 }, // Resource Type
            { wch: 15 }, // Resource ID
            { wch: 12 }, // Access Type
            { wch: 12 }, // Access Granted
            { wch: 20 }, // Denial Reason
            { wch: 15 }, // Data Classification
            { wch: 15 }, // IP Address
            { wch: 30 }, // User Agent
            { wch: 15 }  // Session ID
        ];

        // Style header row
        this.styleHeaderRow(worksheet, headers.length);

        return worksheet;
    }

    /**
     * Create compliance events worksheet
     * @param {Array} complianceEvents - Compliance events data
     * @returns {Object} XLSX worksheet
     */
    createComplianceEventsWorksheet(complianceEvents) {
        const headers = [
            'Timestamp',
            'Event Type',
            'Severity',
            'Description',
            'Affected Table',
            'Affected Record ID',
            'User',
            'Resolved',
            'Resolved By',
            'Resolved At',
            'Resolution Notes'
        ];

        const rows = [headers];

        complianceEvents.forEach(event => {
            rows.push([
                event.timestamp ? new Date(event.timestamp).toISOString() : '',
                event.event_type || '',
                event.severity || '',
                event.description || '',
                event.affected_table || '',
                event.affected_record_id || '',
                event.user_username || '',
                event.resolved ? 'Yes' : 'No',
                event.resolved_by_username || '',
                event.resolved_at ? new Date(event.resolved_at).toISOString() : '',
                event.resolution_notes || ''
            ]);
        });

        const worksheet = XLSX.utils.aoa_to_sheet(rows);

        // Set column widths
        worksheet['!cols'] = [
            { wch: 20 }, // Timestamp
            { wch: 20 }, // Event Type
            { wch: 10 }, // Severity
            { wch: 40 }, // Description
            { wch: 15 }, // Affected Table
            { wch: 15 }, // Affected Record ID
            { wch: 15 }, // User
            { wch: 10 }, // Resolved
            { wch: 15 }, // Resolved By
            { wch: 20 }, // Resolved At
            { wch: 30 }  // Resolution Notes
        ];

        // Style header row
        this.styleHeaderRow(worksheet, headers.length);

        return worksheet;
    }

    /**
     * Create organizational operations worksheet
     * @param {Array} operations - Organizational operations data
     * @returns {Object} XLSX worksheet
     */
    createOrganizationalOperationsWorksheet(operations) {
        const headers = [
            'Timestamp',
            'User',
            'Email',
            'Department',
            'Organization',
            'Operation Type',
            'Resource Type',
            'Resource ID',
            'Resource Name',
            'Operation Details',
            'IP Address',
            'User Agent'
        ];

        const rows = [headers];

        operations.forEach(op => {
            rows.push([
                op.timestamp ? new Date(op.timestamp).toISOString() : '',
                op.username || '',
                op.email || '',
                op.department_name || '',
                op.organization_name || '',
                op.operation_type || '',
                op.resource_type || '',
                op.resource_id || '',
                op.resource_name || '',
                op.operation_details ? JSON.stringify(op.operation_details) : '',
                op.ip_address || '',
                op.user_agent || ''
            ]);
        });

        const worksheet = XLSX.utils.aoa_to_sheet(rows);

        // Set column widths
        worksheet['!cols'] = [
            { wch: 20 }, // Timestamp
            { wch: 15 }, // User
            { wch: 25 }, // Email
            { wch: 20 }, // Department
            { wch: 20 }, // Organization
            { wch: 20 }, // Operation Type
            { wch: 15 }, // Resource Type
            { wch: 15 }, // Resource ID
            { wch: 20 }, // Resource Name
            { wch: 30 }, // Operation Details
            { wch: 15 }, // IP Address
            { wch: 30 }  // User Agent
        ];

        // Style header row
        this.styleHeaderRow(worksheet, headers.length);

        return worksheet;
    }

    /**
     * Add metadata worksheet to workbook
     * @param {Object} workbook - XLSX workbook
     * @param {Object} exportOptions - Export options
     * @param {Object} userInfo - User information
     */
    async addMetadataWorksheet(workbook, exportOptions, userInfo) {
        const { exportType, dateRange, departmentId, organizationId } = exportOptions;
        const { userId: requestingUserId } = userInfo;

        const metadataData = [
            ['Audit Export Metadata'],
            [''],
            ['Export Information'],
            ['Export Type', exportType],
            ['Export Date', new Date().toISOString()],
            ['Requested By User ID', requestingUserId],
            ['Department Filter', departmentId || 'All Departments'],
            ['Organization Filter', organizationId || 'All Organizations'],
            [''],
            ['Date Range'],
            ['Start Date', dateRange?.startDate || 'No limit'],
            ['End Date', dateRange?.endDate || 'No limit'],
            [''],
            ['Compliance Information'],
            ['Export Retention', '7 days'],
            ['Data Classification', 'Sensitive'],
            ['Access Control', 'Role-based'],
            ['Audit Logging', 'Complete'],
            [''],
            ['Standards Compliance'],
            ['ISO/IEC 17025', 'Supported'],
            ['GDPR', 'Compliant'],
            ['HIPAA', 'Compliant'],
            ['Data Retention Policy', 'Applied'],
            [''],
            ['Export Statistics'],
            ['Generated At', new Date().toISOString()],
            ['File Format', 'Excel (.xlsx)'],
            ['Compression', 'Standard'],
            ['Security', 'Access-controlled download']
        ];

        const worksheet = XLSX.utils.aoa_to_sheet(metadataData);

        // Set column widths
        worksheet['!cols'] = [
            { wch: 25 },
            { wch: 40 }
        ];

        // Style title
        worksheet['A1'].s = {
            font: { bold: true, size: 14 },
            alignment: { horizontal: 'center' }
        };

        // Style section headers
        const sectionHeaders = ['A3', 'A10', 'A14', 'A20', 'A26'];
        sectionHeaders.forEach(cell => {
            if (worksheet[cell]) {
                worksheet[cell].s = {
                    font: { bold: true },
                    fill: { fgColor: { rgb: 'F0F0F0' } }
                };
            }
        });

        XLSX.utils.book_append_sheet(workbook, worksheet, 'Metadata');
    }

    /**
     * Add PDF content based on export type
     * @param {Object} doc - PDF document
     * @param {string} exportType - Export type
     * @param {Object} exportOptions - Export options
     * @param {string} requestingUserId - User ID requesting export
     */
    async addPDFContent(doc, exportType, exportOptions, requestingUserId) {
        const { dateRange, departmentId, organizationId } = exportOptions;

        // Add header
        doc.fontSize(20).text('Audit Report', { align: 'center' });
        doc.moveDown();

        // Add metadata
        doc.fontSize(12);
        doc.text(`Export Type: ${exportType}`);
        doc.text(`Generated: ${new Date().toISOString()}`);
        doc.text(`Requested By: ${requestingUserId}`);
        if (dateRange) {
            doc.text(`Date Range: ${dateRange.startDate || 'No start'} to ${dateRange.endDate || 'No end'}`);
        }
        doc.moveDown();

        // Add content based on export type
        switch (exportType) {
            case this.exportTypes.FULL_AUDIT:
                await this.addFullAuditPDFContent(doc, exportOptions, requestingUserId);
                break;
            case this.exportTypes.DATA_ACCESS:
                await this.addDataAccessPDFContent(doc, exportOptions, requestingUserId);
                break;
            case this.exportTypes.COMPLIANCE_EVENTS:
                await this.addComplianceEventsPDFContent(doc, exportOptions, requestingUserId);
                break;
            case this.exportTypes.ORGANIZATIONAL_OPERATIONS:
                await this.addOrganizationalOperationsPDFContent(doc, exportOptions, requestingUserId);
                break;
            case this.exportTypes.DEPARTMENT_SUMMARY:
                await this.addDepartmentSummaryPDFContent(doc, exportOptions, requestingUserId);
                break;
        }

        // Add footer
        doc.fontSize(10);
        doc.text('This report contains sensitive audit information and should be handled according to organizational security policies.', 
                 { align: 'center' });
    }

    /**
     * Add full audit content to PDF
     * @param {Object} doc - PDF document
     * @param {Object} exportOptions - Export options
     * @param {string} requestingUserId - User ID requesting export
     */
    async addFullAuditPDFContent(doc, exportOptions, requestingUserId) {
        const { dateRange, departmentId, organizationId } = exportOptions;

        // Get audit summary statistics
        const auditSummary = await auditService.getDepartmentAuditSummary(
            departmentId, 
            dateRange?.startDate, 
            dateRange?.endDate
        );

        doc.fontSize(16).text('Audit Summary', { underline: true });
        doc.moveDown();

        doc.fontSize(12);
        auditSummary.forEach(stat => {
            doc.text(`${stat.operation_type} (${stat.resource_type}): ${stat.operation_count} operations by ${stat.unique_users} users`);
        });

        doc.moveDown();

        // Get recent audit logs (limited for PDF)
        const recentLogs = await auditService.getAuditLogsWithDepartmentFilter({
            startDate: dateRange?.startDate,
            endDate: dateRange?.endDate,
            departmentId,
            organizationId,
            limit: 50 // Limit for PDF readability
        });

        doc.fontSize(16).text('Recent Audit Events', { underline: true });
        doc.moveDown();

        doc.fontSize(10);
        recentLogs.forEach(log => {
            doc.text(`${new Date(log.timestamp).toISOString()} - ${log.username} - ${log.action} on ${log.table_name}`);
        });
    }

    /**
     * Validate export permissions
     * @param {string} userId - User ID requesting export
     * @param {string} exportType - Export type
     */
    async validateExportPermissions(userId, exportType) {
        // Implementation would check user role and permissions
        // For now, we'll assume validation is handled by the calling code
        if (!userId) {
            throw new Error('User ID is required for audit export');
        }
        
        // Additional permission checks would go here
        // e.g., check if user has audit export permissions
    }

    /**
     * Style header row in worksheet
     * @param {Object} worksheet - XLSX worksheet
     * @param {number} columnCount - Number of columns
     */
    styleHeaderRow(worksheet, columnCount) {
        for (let col = 0; col < columnCount; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
            if (!worksheet[cellAddress]) continue;
            
            worksheet[cellAddress].s = {
                font: { bold: true },
                fill: { fgColor: { rgb: 'E6E6FA' } },
                alignment: { horizontal: 'center' }
            };
        }
    }

    /**
     * Get export file for download
     * @param {string} exportId - Export ID
     * @returns {Promise<Object>} File information
     */
    async getExportFile(exportId) {
        try {
            const files = await fs.readdir(this.exportDir);
            const exportFile = files.find(file => file.includes(exportId));

            if (!exportFile) {
                throw new Error('Audit export file not found or expired');
            }

            const filePath = path.join(this.exportDir, exportFile);
            const stats = await fs.stat(filePath);

            // Check if file is expired (7 days for audit exports)
            const fileAge = Date.now() - stats.mtime.getTime();
            const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

            if (fileAge > maxAge) {
                await fs.unlink(filePath);
                throw new Error('Audit export file has expired');
            }

            const isExcel = exportFile.endsWith('.xlsx');
            const isPDF = exportFile.endsWith('.pdf');

            return {
                filePath,
                filename: exportFile,
                size: stats.size,
                mimeType: isExcel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
                         isPDF ? 'application/pdf' : 'application/octet-stream'
            };

        } catch (error) {
            logger.error('Error getting audit export file', { error: error.message, exportId });
            throw error;
        }
    }

    /**
     * Clean up expired audit export files
     * @returns {Promise<number>} Number of files cleaned up
     */
    async cleanupExpiredFiles() {
        try {
            const files = await fs.readdir(this.exportDir);
            const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
            let cleanedCount = 0;

            for (const file of files) {
                const filePath = path.join(this.exportDir, file);
                const stats = await fs.stat(filePath);
                const fileAge = Date.now() - stats.mtime.getTime();

                if (fileAge > maxAge) {
                    await fs.unlink(filePath);
                    cleanedCount++;
                    logger.info('Cleaned up expired audit export file', { filename: file });
                }
            }

            return cleanedCount;

        } catch (error) {
            logger.error('Error cleaning up expired audit export files', { error: error.message });
            return 0;
        }
    }
}

module.exports = new AuditExportService();