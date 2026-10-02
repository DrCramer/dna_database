/**
 * Result Formatting Service
 * Formats match results for export and display
 */

const { logger } = require('../utils/logger');
const { STR_LOCI } = require('./excelService');

class ResultFormattingService {
  constructor() {
    this.logger = logger;
  }

  /**
   * Format match results for export
   * @param {Array} matchResults - Array of match results
   * @param {Object} searchInfo - Search information
   * @returns {Object} Formatted export data
   */
  formatForExport(matchResults, searchInfo = {}) {
    try {
      const formattedData = {
        data: [],
        lrValues: [],
        organizationalContext: [],
        searchInfo,
        exportId: searchInfo.exportId || this.generateExportId()
      };

      matchResults.forEach((result, index) => {
        // Format basic result data
        const row = [
          result.matchedProfile?.sampleName || 'Unknown',
          result.matchedProfile?.uploadDate ? new Date(result.matchedProfile.uploadDate).toLocaleDateString('ru-RU') : 'N/A',
          `${result.overallMatch || 0}%`,
          result.numericMatchCount || 0,
          result.totalComparisons || 0,
          result.passesThreshold ? 'Да' : 'Нет'
        ];

        // Add profile source information
        row.profileSource = this.getProfileSourceDescription(result.profileSource);
        row.userId = result.matchedProfile?.userId || '';
        row.fileSource = result.matchedProfile?.fileSource || '';
        row.notes = result.notes || '';

        // Add locus details if available
        if (result.locusMatches) {
          STR_LOCI.forEach(locus => {
            const locusData = result.locusMatches[locus];
            if (locusData) {
              row.push(this.formatLocusValue(locusData));
            } else {
              row.push('N/A');
            }
          });
        }

        formattedData.data.push(row);

        // Store LR values separately
        formattedData.lrValues.push(result.likelihoodRatio || result.lrValue || 'N/A');

        // Store organizational context
        formattedData.organizationalContext.push({
          department: result.departmentContext?.department || 'N/A',
          organization: result.departmentContext?.organization || 'N/A'
        });
      });

      return formattedData;

    } catch (error) {
      this.logger.error('Error formatting results for export', {
        error: error.message,
        resultCount: matchResults.length
      });
      throw new Error(`Failed to format results for export: ${error.message}`);
    }
  }

  /**
   * Generate summary statistics from match results
   * @param {Array} matchResults - Array of match results
   * @returns {Object} Summary statistics
   */
  generateSummaryStats(matchResults) {
    if (!matchResults || matchResults.length === 0) {
      return {
        averageMatch: 0,
        highMatches: 0,
        perfectMatches: 0,
        distributionByRange: {
          '90-100%': 0,
          '80-89%': 0,
          '70-79%': 0,
          '60-69%': 0,
          '50-59%': 0,
          'Below 50%': 0
        }
      };
    }

    const matches = matchResults.map(r => r.overallMatch || 0);
    const averageMatch = matches.reduce((sum, match) => sum + match, 0) / matches.length;
    
    const highMatches = matches.filter(m => m >= 80).length;
    const perfectMatches = matches.filter(m => m === 100).length;

    const distributionByRange = {
      '90-100%': matches.filter(m => m >= 90).length,
      '80-89%': matches.filter(m => m >= 80 && m < 90).length,
      '70-79%': matches.filter(m => m >= 70 && m < 80).length,
      '60-69%': matches.filter(m => m >= 60 && m < 70).length,
      '50-59%': matches.filter(m => m >= 50 && m < 60).length,
      'Below 50%': matches.filter(m => m < 50).length
    };

    return {
      averageMatch: Math.round(averageMatch * 10) / 10,
      highMatches,
      perfectMatches,
      distributionByRange
    };
  }

  /**
   * Format locus value for display
   * @param {Object} locusData - Locus data
   * @returns {string} Formatted locus value
   */
  formatLocusValue(locusData) {
    if (!locusData) return 'N/A';

    if (locusData.profile1Value && locusData.profile2Value) {
      return `${locusData.profile1Value} vs ${locusData.profile2Value}`;
    } else if (locusData.value) {
      return locusData.value;
    } else if (locusData.alleles && Array.isArray(locusData.alleles)) {
      return locusData.alleles.join('/');
    }

    return 'N/A';
  }

  /**
   * Get profile source description
   * @param {string} profileSource - Profile source
   * @returns {string} Description
   */
  getProfileSourceDescription(profileSource) {
    switch (profileSource) {
      case 'master_array':
        return 'Мастер-массив';
      case 'user_profile':
        return 'Пользовательский профиль';
      case 'department_colleague':
        return 'Коллега по отделу';
      case 'audit_record':
        return 'Запись аудита';
      default:
        return 'Неизвестно';
    }
  }

  /**
   * Generate unique export ID
   * @returns {string} Export ID
   */
  generateExportId() {
    const crypto = require('crypto');
    return crypto.randomUUID();
  }

  /**
   * Format results for display in UI
   * @param {Array} matchResults - Array of match results
   * @returns {Array} Formatted results for UI
   */
  formatForDisplay(matchResults) {
    try {
      return matchResults.map(result => ({
        id: result.id || this.generateExportId(),
        sampleName: result.matchedProfile?.sampleName || 'Unknown',
        uploadDate: result.matchedProfile?.uploadDate,
        matchPercentage: result.overallMatch || 0,
        numericMatches: result.numericMatchCount || 0,
        totalComparisons: result.totalComparisons || 0,
        passesThreshold: result.passesThreshold || false,
        profileSource: this.getProfileSourceDescription(result.profileSource),
        likelihoodRatio: result.likelihoodRatio || result.lrValue,
        locusMatches: result.locusMatches || {},
        notes: result.notes || ''
      }));

    } catch (error) {
      this.logger.error('Error formatting results for display', {
        error: error.message,
        resultCount: matchResults.length
      });
      throw new Error(`Failed to format results for display: ${error.message}`);
    }
  }

  /**
   * Validate match results structure
   * @param {Array} matchResults - Array of match results
   * @returns {boolean} True if valid
   */
  validateMatchResults(matchResults) {
    if (!Array.isArray(matchResults)) {
      return false;
    }

    return matchResults.every(result => {
      return result &&
             typeof result === 'object' &&
             result.matchedProfile &&
             typeof result.overallMatch === 'number' &&
             typeof result.numericMatchCount === 'number' &&
             typeof result.totalComparisons === 'number';
    });
  }

  /**
   * Clean and sanitize match results
   * @param {Array} matchResults - Array of match results
   * @returns {Array} Cleaned results
   */
  cleanMatchResults(matchResults) {
    if (!Array.isArray(matchResults)) {
      return [];
    }

    return matchResults.filter(result => {
      return result &&
             result.matchedProfile &&
             result.matchedProfile.sampleName &&
             typeof result.overallMatch === 'number' &&
             !isNaN(result.overallMatch);
    }).map(result => ({
      ...result,
      overallMatch: Math.max(0, Math.min(100, result.overallMatch)),
      numericMatchCount: Math.max(0, result.numericMatchCount || 0),
      totalComparisons: Math.max(1, result.totalComparisons || 1)
    }));
  }
}

module.exports = {
  ResultFormattingService
};