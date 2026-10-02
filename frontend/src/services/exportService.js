import api from './authService';

export const exportService = {
  // Export analysis results to Excel format
  async exportToExcel(data, filename) {
    try {
      // Convert data to the format expected by /api/export/excel
      const exportPayload = this.convertToExportFormat(data, filename);
      
      const response = await api.post('/api/export/excel', exportPayload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        if (response.data.backgroundProcessing) {
          // Handle background processing
          return { 
            success: true, 
            message: 'Export is being processed in the background',
            jobId: response.data.job.jobId,
            statusUrl: response.data.job.statusUrl
          };
        } else {
          // Handle immediate processing - download the file
          const downloadUrl = response.data.export.downloadUrl;
          const downloadResponse = await api.get(downloadUrl, {
            responseType: 'blob'
          });
          
          this.downloadFile(downloadResponse.data, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          return { success: true, message: 'Excel export completed successfully' };
        }
      } else {
        throw new Error(response.data.message || 'Export failed');
      }
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Excel export failed');
    }
  },

  // Convert analysis data to the format expected by the export API
  convertToExportFormat(data, filename) {
    const { analysisType, results } = data;
    
    // Convert results to matchResults format
    let matchResults = [];
    
    // Handle bayesian analysis type - determine specific type from results
    let actualAnalysisType = analysisType;
    if (analysisType === 'bayesian') {
      // Determine specific analysis type from results structure
      if (results.profiles && results.analysis && results.analysis.overallLR) {
        actualAnalysisType = 'compare';
      } else if (results.analysis && results.analysis.isContaminated !== undefined) {
        actualAnalysisType = 'contamination';
      } else if (results.duplicates) {
        actualAnalysisType = 'duplicates';
      } else if (results.analysis && results.analysis.degradationIndex !== undefined) {
        actualAnalysisType = 'degradation';
      }
    }
    
    // ИСПРАВЛЕНО: Используем реальные данные из results
    if ((actualAnalysisType === 'compare' || actualAnalysisType === 'bayesian') && results.profiles) {
      // LR comparison results - используем реальные данные профилей
      const profile1 = results.profiles.profile1 || {};
      const profile2 = results.profiles.profile2 || {};
      const analysis = results.analysis || {};
      
      matchResults = [{
        matchedProfile: {
          id: profile2.id || profile2.profileId || 'unknown',
          sampleName: profile2.sampleName || profile2.name || 'Unknown Profile',
          uploadDate: profile2.uploadDate || profile2.createdAt || new Date(),
          userId: profile2.userId || profile2.user_id || 'unknown',
          profileType: profile2.profileType || 'user'
        },
        queryProfile: {
          id: profile1.id || profile1.profileId || 'unknown',
          sampleName: profile1.sampleName || profile1.name || 'Query Profile',
          uploadDate: profile1.uploadDate || profile1.createdAt || new Date(),
          userId: profile1.userId || profile1.user_id || 'unknown'
        },
        overallMatch: analysis.overallLR ? Math.min(100, Math.log10(Math.max(analysis.overallLR, 0.001)) * 10 + 50) : 0,
        numericMatchCount: analysis.matchingLoci || analysis.totalMatches || 0,
        totalComparisons: analysis.totalLoci || analysis.totalComparisons || 39,
        passesThreshold: analysis.overallLR > 1,
        likelihoodRatio: analysis.overallLR,
        lrSignificance: this.getLRSignificance(analysis.overallLR),
        locusMatches: analysis.locusLRs || analysis.locusMatches || {},
        analysisDate: results.analysisTimestamp ? new Date(results.analysisTimestamp) : new Date(),
        populationUsed: results.populationUsed || 'Default',
        organizationalContext: {
          department: 'Analysis Department',
          organization: 'Forensic Lab',
          userRole: 'analyst'
        },
        // Добавляем дополнительные данные для PDF
        analysisMetadata: {
          analysisType: actualAnalysisType,
          populationData: results.populationUsed,
          timestamp: results.analysisTimestamp,
          confidenceInterval: analysis.confidenceInterval
        }
      }];
    } else if (actualAnalysisType === 'duplicates' && results.duplicates) {
      // Duplicate search results - используем реальные данные дубликатов
      const targetProfile = results.targetProfile || {};
      
      matchResults = results.duplicates.map(duplicate => ({
        matchedProfile: {
          id: duplicate.matchedProfile?.id || duplicate.id || 'unknown',
          sampleName: duplicate.matchedProfile?.sampleName || duplicate.sampleName || 'Unknown Profile',
          uploadDate: duplicate.matchedProfile?.uploadDate || duplicate.uploadDate || new Date(),
          userId: duplicate.matchedProfile?.userId || duplicate.userId || 'unknown',
          profileType: duplicate.matchedProfile?.profileType || 'user'
        },
        queryProfile: {
          id: targetProfile.id || 'unknown',
          sampleName: targetProfile.sampleName || 'Target Profile',
          uploadDate: targetProfile.uploadDate || new Date(),
          userId: targetProfile.userId || 'unknown'
        },
        overallMatch: (duplicate.probability || 0) * 100,
        numericMatchCount: duplicate.matchingLoci || 0,
        totalComparisons: duplicate.totalLoci || 39,
        passesThreshold: (duplicate.probability || 0) > 0.8,
        likelihoodRatio: duplicate.lrScore,
        lrSignificance: this.getLRSignificance(duplicate.lrScore),
        locusMatches: duplicate.locusMatches || {},
        analysisDate: results.analysisTimestamp ? new Date(results.analysisTimestamp) : new Date(),
        populationUsed: results.populationUsed || 'Default',
        organizationalContext: {
          department: 'Analysis Department',
          organization: 'Forensic Lab',
          userRole: 'analyst'
        },
        analysisMetadata: {
          analysisType: actualAnalysisType,
          searchStatistics: results.searchStatistics,
          threshold: results.searchStatistics?.threshold
        }
      }));
    } else if (actualAnalysisType === 'contamination' && results.profile) {
      // Contamination results - используем реальные данные профиля
      const profile = results.profile || {};
      const analysis = results.analysis || {};
      
      matchResults = [{
        matchedProfile: {
          id: profile.id || profile.profileId || 'unknown',
          sampleName: profile.sampleName || profile.name || 'Unknown Profile',
          uploadDate: profile.uploadDate || profile.createdAt || new Date(),
          userId: profile.userId || profile.user_id || 'unknown',
          profileType: profile.profileType || 'user'
        },
        overallMatch: analysis.isContaminated ? 0 : 100,
        numericMatchCount: analysis.cleanLoci || 0,
        totalComparisons: analysis.totalLoci || 39,
        passesThreshold: !analysis.isContaminated,
        likelihoodRatio: analysis.contaminationProbability ? (1 - analysis.contaminationProbability) : 1,
        locusMatches: analysis.flaggedLoci ? 
          analysis.flaggedLoci.reduce((acc, locus) => {
            acc[locus.locusName] = {
              match: !locus.issue,
              issue: locus.issue,
              probability: locus.probability,
              alleles: locus.alleles
            };
            return acc;
          }, {}) : {},
        analysisDate: results.analysisTimestamp ? new Date(results.analysisTimestamp) : new Date(),
        populationUsed: results.populationUsed || 'Default',
        organizationalContext: {
          department: 'Analysis Department',
          organization: 'Forensic Lab',
          userRole: 'analyst'
        },
        analysisMetadata: {
          analysisType: actualAnalysisType,
          contaminationProbability: analysis.contaminationProbability,
          confidence: analysis.confidence,
          flaggedLoci: analysis.flaggedLoci
        }
      }];
    } else if (actualAnalysisType === 'degradation' && results.profile) {
      // Degradation results - используем реальные данные профиля
      const profile = results.profile || {};
      const analysis = results.analysis || {};
      
      matchResults = [{
        matchedProfile: {
          id: profile.id || profile.profileId || 'unknown',
          sampleName: profile.sampleName || profile.name || 'Unknown Profile',
          uploadDate: profile.uploadDate || profile.createdAt || new Date(),
          userId: profile.userId || profile.user_id || 'unknown',
          profileType: profile.profileType || 'user'
        },
        overallMatch: analysis.qualityScore ? (analysis.qualityScore * 100) : 50,
        numericMatchCount: analysis.validLoci || 0,
        totalComparisons: analysis.totalLoci || 39,
        passesThreshold: (analysis.degradationIndex || 0) < 0.5,
        likelihoodRatio: analysis.degradationIndex ? (1 - analysis.degradationIndex) : 0.5,
        locusMatches: {},
        analysisDate: results.analysisTimestamp ? new Date(results.analysisTimestamp) : new Date(),
        populationUsed: results.populationUsed || 'Default',
        organizationalContext: {
          department: 'Analysis Department',
          organization: 'Forensic Lab',
          userRole: 'analyst'
        },
        analysisMetadata: {
          analysisType: actualAnalysisType,
          degradationIndex: analysis.degradationIndex,
          qualityScore: analysis.qualityScore,
          confidenceInterval: analysis.confidenceInterval
        }
      }];
    } else {
      // Fallback - создаем минимальные данные только если нет других вариантов
      console.warn('Using fallback export format for unknown analysis type:', actualAnalysisType, results);
      
      matchResults = [{
        matchedProfile: {
          id: 'analysis-result',
          sampleName: `${actualAnalysisType} Analysis Result`,
          uploadDate: new Date(),
          userId: 'system'
        },
        overallMatch: 100,
        numericMatchCount: 1,
        totalComparisons: 1,
        passesThreshold: true,
        likelihoodRatio: 1,
        locusMatches: {},
        analysisDate: results.analysisTimestamp ? new Date(results.analysisTimestamp) : new Date(),
        populationUsed: results.populationUsed || 'Default',
        organizationalContext: {
          department: 'Analysis Department',
          organization: 'Forensic Lab',
          userRole: 'analyst'
        },
        analysisMetadata: {
          analysisType: actualAnalysisType,
          rawResults: results // Включаем сырые данные для отладки
        }
      }];
    }

    return {
      matchResults,
      exportOptions: {
        includeProfileDetails: true,
        includeLocusDetails: true,
        includeMetadata: true,
        includeLRValues: true,
        includeOrganizationalContext: true,
        filename: filename || `${actualAnalysisType}_export_${Date.now()}.pdf`
      },
      searchInfo: {
        targetProfile: results.profiles?.profile1 || results.profile || results.targetProfile || { 
          sampleName: 'Target Profile',
          id: 'target-profile'
        },
        searchDate: results.analysisTimestamp || data.exportTimestamp || new Date().toISOString(),
        totalResults: matchResults.length,
        analysisType: actualAnalysisType,
        options: {
          threshold: results.searchStatistics?.threshold || 80,
          includePartial: true,
          useBayesian: true,
          populationData: results.populationUsed || 'Default'
        },
        organizationalContext: {
          department: 'Analysis Department',
          organization: 'Forensic Lab'
        },
        // Добавляем дополнительную информацию для PDF
        analysisMetadata: {
          timestamp: results.analysisTimestamp,
          populationUsed: results.populationUsed,
          analysisType: actualAnalysisType,
          exportTimestamp: data.exportTimestamp
        }
      }
    };
  },

  // Get LR significance description
  getLRSignificance(lrValue) {
    if (!lrValue || lrValue === 'N/A') return 'N/A';
    
    const lr = parseFloat(lrValue);
    if (isNaN(lr)) return 'Invalid';

    if (lr >= 1000000) return 'Extremely Strong Support';
    if (lr >= 10000) return 'Very Strong Support';
    if (lr >= 100) return 'Strong Support';
    if (lr >= 10) return 'Moderate Support';
    if (lr >= 1) return 'Limited Support';
    if (lr >= 0.1) return 'Limited Opposition';
    if (lr >= 0.01) return 'Moderate Opposition';
    if (lr >= 0.001) return 'Strong Opposition';
    if (lr >= 0.0001) return 'Very Strong Opposition';
    return 'Extremely Strong Opposition';
  },

  // Export analysis results to CSV format
  async exportToCSV(data, filename) {
    try {
      const csvContent = this.convertToCSV(data);
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      this.downloadFile(blob, filename, 'text/csv');
      return { success: true, message: 'CSV export completed successfully' };
    } catch (error) {
      throw new Error('CSV export failed: ' + error.message);
    }
  },

  // Export analysis results to JSON format
  async exportToJSON(data, filename) {
    try {
      const jsonContent = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
      this.downloadFile(blob, filename, 'application/json');
      return { success: true, message: 'JSON export completed successfully' };
    } catch (error) {
      throw new Error('JSON export failed: ' + error.message);
    }
  },

  // Export analysis results to PDF format
  async exportToPDF(data, filename) {
    try {
      // Convert data to the format expected by /api/export/pdf
      const exportPayload = this.convertToExportFormat(data, filename);
      
      const response = await api.post('/api/export/pdf', exportPayload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        // Handle PDF export - download the file
        const downloadUrl = response.data.export.downloadUrl;
        const downloadResponse = await api.get(downloadUrl, {
          responseType: 'blob'
        });
        
        this.downloadFile(downloadResponse.data, filename, 'application/pdf');
        return { success: true, message: 'PDF export completed successfully' };
      } else {
        throw new Error(response.data.message || 'PDF export failed');
      }
    } catch (error) {
      throw new Error(error.response?.data?.message || 'PDF export failed');
    }
  },

  // Convert data to CSV format
  convertToCSV(data) {
    const { analysisType, results } = data;
    let csvContent = '';

    // Add header information
    csvContent += 'Analysis Export Report\n';
    csvContent += `Analysis Type,${analysisType}\n`;
    csvContent += `Export Date,${new Date().toISOString()}\n`;
    csvContent += `Export Timestamp,${data.exportTimestamp}\n`;
    csvContent += '\n';

    // Add analysis-specific data
    switch (analysisType) {
      case 'compare':
        csvContent += this.formatLRComparisonCSV(results);
        break;
      case 'contamination':
        csvContent += this.formatContaminationCSV(results);
        break;
      case 'degradation':
        csvContent += this.formatDegradationCSV(results);
        break;
      case 'duplicates':
        csvContent += this.formatDuplicatesCSV(results);
        break;
      default:
        csvContent += this.formatGenericCSV(results);
    }

    return csvContent;
  },

  // Format LR comparison results for CSV
  formatLRComparisonCSV(results) {
    let csv = 'Profile Comparison Results\n';
    csv += 'Profile 1,Profile 2,Overall LR,Population Used,Analysis Date\n';
    
    const { profiles, analysis, populationUsed, analysisTimestamp } = results;
    csv += `"${profiles.profile1.sampleName}","${profiles.profile2.sampleName}",${analysis.overallLR},"${populationUsed}","${analysisTimestamp}"\n`;
    csv += '\n';

    if (analysis.locusLRs && Object.keys(analysis.locusLRs).length > 0) {
      csv += 'Locus-by-Locus Results\n';
      csv += 'Locus,LR Value\n';
      Object.entries(analysis.locusLRs).forEach(([locus, lr]) => {
        csv += `"${locus}",${lr}\n`;
      });
      csv += '\n';
    }

    if (analysis.confidenceInterval) {
      csv += 'Statistical Information\n';
      csv += 'Metric,Value\n';
      csv += `"95% CI Lower",${analysis.confidenceInterval[0]}\n`;
      csv += `"95% CI Upper",${analysis.confidenceInterval[1]}\n`;
    }

    return csv;
  },

  // Format contamination results for CSV
  formatContaminationCSV(results) {
    let csv = 'Contamination Detection Results\n';
    csv += 'Profile,Contaminated,Contamination Probability,Confidence,Population Used,Analysis Date\n';
    
    const { profile, analysis, populationUsed, analysisTimestamp } = results;
    csv += `"${profile.sampleName}",${analysis.isContaminated},${analysis.contaminationProbability},${analysis.confidence},"${populationUsed}","${analysisTimestamp}"\n`;
    csv += '\n';

    if (analysis.flaggedLoci && analysis.flaggedLoci.length > 0) {
      csv += 'Flagged Loci\n';
      csv += 'Locus,Issue,Allele Count,Expected Alleles,Contamination Probability\n';
      analysis.flaggedLoci.forEach(locus => {
        csv += `"${locus.locusName}","${locus.issue || 'Contamination detected'}",${locus.alleleCount || ''},${locus.expectedAlleles || ''},${locus.probability || ''}\n`;
      });
    }

    return csv;
  },

  // Format degradation results for CSV
  formatDegradationCSV(results) {
    let csv = 'Degradation Assessment Results\n';
    csv += 'Profile,Degradation Index,Quality Score,Analysis Date\n';
    
    const { profile, analysis, analysisTimestamp } = results;
    csv += `"${profile.sampleName}",${analysis.degradationIndex},${analysis.qualityScore},"${analysisTimestamp}"\n`;
    csv += '\n';

    if (analysis.confidenceInterval) {
      csv += 'Statistical Information\n';
      csv += 'Metric,Value\n';
      csv += `"95% CI Lower",${analysis.confidenceInterval[0]}\n`;
      csv += `"95% CI Upper",${analysis.confidenceInterval[1]}\n`;
    }

    return csv;
  },

  // Format duplicate search results for CSV
  formatDuplicatesCSV(results) {
    let csv = 'Duplicate Search Results\n';
    csv += 'Target Profile,Search Space Size,Matches Found,Threshold,Population Used,Analysis Date\n';
    
    const { targetProfile, duplicates, searchStatistics, populationUsed, analysisTimestamp } = results;
    csv += `"${targetProfile.sampleName}",${searchStatistics.searchSpaceSize},${searchStatistics.totalMatches},${searchStatistics.threshold},"${populationUsed}","${analysisTimestamp}"\n`;
    csv += '\n';

    if (duplicates && duplicates.length > 0) {
      csv += 'Potential Duplicates\n';
      csv += 'Sample Name,Profile ID,Probability,LR Score,Matching Loci,Total Loci\n';
      duplicates.forEach(duplicate => {
        csv += `"${duplicate.matchedProfile.sampleName}","${duplicate.matchedProfile.id}",${duplicate.probability},${duplicate.lrScore || ''},${duplicate.matchingLoci || ''},${duplicate.totalLoci || ''}\n`;
      });
    }

    return csv;
  },

  // Format generic results for CSV
  formatGenericCSV(results) {
    let csv = 'Analysis Results\n';
    csv += 'Key,Value\n';
    
    const flattenObject = (obj, prefix = '') => {
      Object.entries(obj).forEach(([key, value]) => {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          flattenObject(value, fullKey);
        } else {
          csv += `"${fullKey}","${Array.isArray(value) ? value.join('; ') : value}"\n`;
        }
      });
    };

    flattenObject(results);
    return csv;
  },

  // Generate PDF content (simplified text format)
  generatePDFContent(data) {
    const { analysisType, results, exportTimestamp } = data;
    let content = '';

    content += '='.repeat(60) + '\n';
    content += 'BAYESIAN ANALYSIS REPORT\n';
    content += '='.repeat(60) + '\n\n';

    content += `Analysis Type: ${analysisType.toUpperCase()}\n`;
    content += `Export Date: ${new Date(exportTimestamp).toLocaleString()}\n`;
    content += `Analysis Date: ${results.analysisTimestamp ? new Date(results.analysisTimestamp).toLocaleString() : 'Unknown'}\n\n`;

    // Add analysis-specific content
    switch (analysisType) {
      case 'compare':
        content += this.formatLRComparisonText(results);
        break;
      case 'contamination':
        content += this.formatContaminationText(results);
        break;
      case 'degradation':
        content += this.formatDegradationText(results);
        break;
      case 'duplicates':
        content += this.formatDuplicatesText(results);
        break;
      default:
        content += JSON.stringify(results, null, 2);
    }

    content += '\n' + '='.repeat(60) + '\n';
    content += 'End of Report\n';
    content += '='.repeat(60) + '\n';

    return content;
  },

  // Format LR comparison for text
  formatLRComparisonText(results) {
    const { profiles, analysis, populationUsed } = results;
    let text = 'PROFILE COMPARISON RESULTS\n';
    text += '-'.repeat(30) + '\n\n';

    text += `Profile 1: ${profiles.profile1.sampleName}\n`;
    text += `Profile 2: ${profiles.profile2.sampleName}\n`;
    text += `Population: ${populationUsed}\n\n`;

    text += `Overall Likelihood Ratio: ${analysis.overallLR}\n`;
    
    if (analysis.confidenceInterval) {
      text += `95% Confidence Interval: [${analysis.confidenceInterval[0]}, ${analysis.confidenceInterval[1]}]\n`;
    }

    if (analysis.locusLRs && Object.keys(analysis.locusLRs).length > 0) {
      text += '\nLocus-by-Locus Results:\n';
      Object.entries(analysis.locusLRs).forEach(([locus, lr]) => {
        text += `  ${locus}: ${lr}\n`;
      });
    }

    return text + '\n';
  },

  // Format contamination for text
  formatContaminationText(results) {
    const { profile, analysis, populationUsed } = results;
    let text = 'CONTAMINATION DETECTION RESULTS\n';
    text += '-'.repeat(35) + '\n\n';

    text += `Profile: ${profile.sampleName}\n`;
    text += `Population: ${populationUsed}\n\n`;

    text += `Contamination Status: ${analysis.isContaminated ? 'CONTAMINATED' : 'CLEAN'}\n`;
    text += `Contamination Probability: ${(analysis.contaminationProbability * 100).toFixed(1)}%\n`;
    text += `Confidence Level: ${(analysis.confidence * 100).toFixed(1)}%\n`;

    if (analysis.flaggedLoci && analysis.flaggedLoci.length > 0) {
      text += '\nFlagged Loci:\n';
      analysis.flaggedLoci.forEach(locus => {
        text += `  ${locus.locusName}: ${locus.issue || 'Contamination detected'}\n`;
      });
    }

    return text + '\n';
  },

  // Format degradation for text
  formatDegradationText(results) {
    const { profile, analysis } = results;
    let text = 'DEGRADATION ASSESSMENT RESULTS\n';
    text += '-'.repeat(35) + '\n\n';

    text += `Profile: ${profile.sampleName}\n\n`;

    text += `Degradation Index: ${(analysis.degradationIndex * 100).toFixed(1)}%\n`;
    text += `Quality Score: ${(analysis.qualityScore * 100).toFixed(0)}%\n`;

    if (analysis.confidenceInterval) {
      text += `95% Confidence Interval: [${(analysis.confidenceInterval[0] * 100).toFixed(1)}%, ${(analysis.confidenceInterval[1] * 100).toFixed(1)}%]\n`;
    }

    return text + '\n';
  },

  // Format duplicates for text
  formatDuplicatesText(results) {
    const { targetProfile, duplicates, searchStatistics, populationUsed } = results;
    let text = 'DUPLICATE SEARCH RESULTS\n';
    text += '-'.repeat(25) + '\n\n';

    text += `Target Profile: ${targetProfile.sampleName}\n`;
    text += `Population: ${populationUsed}\n`;
    text += `Search Space: ${searchStatistics.searchSpaceSize} profiles\n`;
    text += `Threshold: ${(searchStatistics.threshold * 100).toFixed(1)}%\n\n`;

    text += `Potential Duplicates Found: ${duplicates.length}\n\n`;

    if (duplicates.length > 0) {
      duplicates.forEach((duplicate, index) => {
        text += `${index + 1}. ${duplicate.matchedProfile.sampleName}\n`;
        text += `   Probability: ${(duplicate.probability * 100).toFixed(1)}%\n`;
        if (duplicate.lrScore) {
          text += `   LR Score: ${duplicate.lrScore.toExponential(2)}\n`;
        }
        text += '\n';
      });
    }

    return text;
  },

  // Download file helper
  downloadFile(blob, filename, mimeType) {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },

  // Get supported export formats
  getSupportedFormats() {
    return [
      {
        format: 'excel',
        label: 'Excel (.xlsx)',
        description: 'Structured spreadsheet with multiple sheets',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      },
      {
        format: 'csv',
        label: 'CSV (.csv)',
        description: 'Comma-separated values for data analysis',
        mimeType: 'text/csv'
      },
      {
        format: 'json',
        label: 'JSON (.json)',
        description: 'Machine-readable format for integration',
        mimeType: 'application/json'
      },
      {
        format: 'pdf',
        label: 'PDF (.pdf)',
        description: 'Formatted report document',
        mimeType: 'application/pdf'
      }
    ];
  },

  // Validate export data
  validateExportData(data) {
    const errors = [];

    if (!data) {
      errors.push('No data provided for export');
      return { isValid: false, errors };
    }

    if (!data.analysisType) {
      errors.push('Analysis type is required');
    }

    if (!data.results) {
      errors.push('Analysis results are required');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
};