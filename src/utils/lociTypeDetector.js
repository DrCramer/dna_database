/**
 * Loci Type Detection Utility
 * Provides classification and validation for all 80 genetic loci types
 */

// Loci type definitions
const LOCI_TYPES = {
    STR: 'STR',
    SNP: 'SNP', 
    Y_CHROMOSOME: 'Y_CHROMOSOME',
    X_CHROMOSOME: 'X_CHROMOSOME',
    AMELOGENIN: 'AMELOGENIN',
    INDEL: 'INDEL',
    OTHER: 'OTHER'
};

// STR (Short Tandem Repeat) loci
const STR_LOCI = [
    'D3S1358', 'D1S1656', 'D2S441', 'D10S1248', 'D13S317', 'D16S539', 
    'D18S51', 'D2S1338', 'CSF1PO', 'TH01', 'vWA', 'D21S11', 'D7S820', 
    'D5S818', 'TPOX', 'D8S1179', 'D12S391', 'D19S433', 'D22S1045', 'FGA',
    'D6S1043', 'D6S477', 'D18S535', 'D19S253', 'D15S659', 'D11S2368', 
    'D20S470', 'D22-GATA198B05', 'D7S3048', 'D8S1132', 'D4S2366', 'D21S1270',
    'D13S325', 'D9S925', 'D3S3045', 'D14S608', 'D10S1435', 'D17S1290', 
    'D5S2500', 'D7S1517', 'D3S1744', 'D2S1360', 'D6S474', 'D21S2055', 
    'D10S2325', 'D18S1364', 'D5S2800', 'D9S1122', 'D20S482', 'D17S1301', 
    'D14S1434', 'D12ATA63', 'D1S1677', 'D11S4463', 'D1S1627', 'D3S4529', 
    'D6S1017', 'D4S2408', 'D1GATA113', 'D18S853', 'D2S1776'
];

// Y-chromosome markers
const Y_CHROMOSOME_LOCI = [
    'DYS391', 'DYS576', 'DYS570', 'DYS392', 'SRY', 'DYS518'
];

// X-chromosome markers
const X_CHROMOSOME_LOCI = [
    'DXS6795'
];

// SNP (Single Nucleotide Polymorphism) markers
const SNP_LOCI = [
    'Rs2032678', 'Rs771783753'
];

// Amelogenin (sex determination)
const AMELOGENIN_LOCI = [
    'AMEL'
];

// Insertion/Deletion markers
const INDEL_LOCI = [
    'Yindel'
];

// Pentanucleotide repeat markers
const PENTA_LOCI = [
    'Penta E', 'Penta D', 'Penta C'
];

// Other genetic markers
const OTHER_LOCI = [
    'SE33', 'LPL', 'F13B', 'FESFPS', 'F13A01'
];

// All supported loci (80 total)
const ALL_LOCI = [
    ...STR_LOCI,
    ...Y_CHROMOSOME_LOCI,
    ...X_CHROMOSOME_LOCI,
    ...SNP_LOCI,
    ...AMELOGENIN_LOCI,
    ...INDEL_LOCI,
    ...PENTA_LOCI,
    ...OTHER_LOCI
];

class LociTypeDetector {
    constructor() {
        this.lociTypeMap = this.buildLociTypeMap();
        this.canonicalNames = new Map(ALL_LOCI.map(name => [this.normalizeName(name), name]));
    }

    /**
     * Build a map of locus name to locus type
     */
    buildLociTypeMap() {
        const map = new Map();
        
        STR_LOCI.forEach(locus => map.set(locus.toUpperCase(), LOCI_TYPES.STR));
        PENTA_LOCI.forEach(locus => map.set(locus.toUpperCase(), LOCI_TYPES.STR)); // Penta are STR variants
        Y_CHROMOSOME_LOCI.forEach(locus => map.set(locus.toUpperCase(), LOCI_TYPES.Y_CHROMOSOME));
        X_CHROMOSOME_LOCI.forEach(locus => map.set(locus.toUpperCase(), LOCI_TYPES.X_CHROMOSOME));
        SNP_LOCI.forEach(locus => map.set(locus.toUpperCase(), LOCI_TYPES.SNP));
        AMELOGENIN_LOCI.forEach(locus => map.set(locus.toUpperCase(), LOCI_TYPES.AMELOGENIN));
        INDEL_LOCI.forEach(locus => map.set(locus.toUpperCase(), LOCI_TYPES.INDEL));
        OTHER_LOCI.forEach(locus => map.set(locus.toUpperCase(), LOCI_TYPES.OTHER));
        
        return map;
    }

    /**
     * Detect the type of a genetic locus
     * @param {string} locusName - Name of the locus
     * @returns {string} Locus type
     */
    detectLocusType(locusName) {
        if (!locusName || typeof locusName !== 'string') {
            throw new Error('Указано недопустимое название локуса');
        }

        let normalizedName = locusName.trim().toUpperCase();
        
        // Специальная нормализация для Penta: добавляем пробел если его нет
        // "PENTAE" → "PENTA E", "PENTAD" → "PENTA D", "PENTAC" → "PENTA C"
        normalizedName = normalizedName.replace(/^PENTA([EDC])$/, 'PENTA $1');
        
        // Direct lookup first
        const directType = this.lociTypeMap.get(normalizedName);
        if (directType) {
            return directType;
        }

        // Pattern-based detection for unknown loci
        if (normalizedName.startsWith('DYS')) {
            return LOCI_TYPES.Y_CHROMOSOME;
        }
        
        if (normalizedName.startsWith('DXS')) {
            return LOCI_TYPES.X_CHROMOSOME;
        }
        
        if (normalizedName.startsWith('RS') || normalizedName.includes('SNP')) {
            return LOCI_TYPES.SNP;
        }
        
        if (normalizedName.includes('INDEL') || normalizedName.includes('YINDEL')) {
            return LOCI_TYPES.INDEL;
        }
        
        if (normalizedName.startsWith('D') && normalizedName.includes('S')) {
            return LOCI_TYPES.STR;
        }

        return LOCI_TYPES.OTHER;
    }

    /**
     * Check if a locus is supported by the system
     * @param {string} locusName - Name of the locus
     * @returns {boolean} True if supported
     */
    isLocusSupported(locusName) {
        if (!locusName || typeof locusName !== 'string') {
            return false;
        }

        return this.getCanonicalLocusName(locusName) !== null;
    }

    // Каноническое имя всегда берётся из ALL_LOCI.
    normalizeName(name) {
        return String(name).trim().replace(/\s+/g, ' ').toUpperCase()
            .replace(/^PENTA\s*([EDC])$/, 'PENTA $1');
    }

    getCanonicalLocusName(name) {
        if (typeof name !== 'string') return null;
        return this.canonicalNames.get(this.normalizeName(name)) || null;
    }

    /**
     * Get all loci of a specific type
     * @param {string} locusType - Type of loci to retrieve
     * @returns {Array<string>} Array of locus names
     */
    getLociByType(locusType) {
        switch (locusType) {
            case LOCI_TYPES.STR:
                return [...STR_LOCI, ...PENTA_LOCI];
            case LOCI_TYPES.Y_CHROMOSOME:
                return [...Y_CHROMOSOME_LOCI];
            case LOCI_TYPES.X_CHROMOSOME:
                return [...X_CHROMOSOME_LOCI];
            case LOCI_TYPES.SNP:
                return [...SNP_LOCI];
            case LOCI_TYPES.AMELOGENIN:
                return [...AMELOGENIN_LOCI];
            case LOCI_TYPES.INDEL:
                return [...INDEL_LOCI];
            case LOCI_TYPES.OTHER:
                return [...OTHER_LOCI];
            default:
                throw new Error(`Неизвестный тип локуса: ${locusType}`);
        }
    }

    /**
     * Validate allele values for a specific locus type
     * @param {string} locusName - Name of the locus
     * @param {Array<string>} alleles - Allele values
     * @returns {Object} Validation result
     */
    validateAlleles(locusName, alleles) {
        const locusType = this.detectLocusType(locusName);
        const result = {
            isValid: true,
            errors: [],
            warnings: []
        };

        if (!alleles || !Array.isArray(alleles)) {
            result.isValid = false;
            result.errors.push('Аллели должны быть представлены в виде массива');
            return result;
        }

        switch (locusType) {
            case LOCI_TYPES.STR:
                return this.validateSTRAlleles(alleles);
            case LOCI_TYPES.Y_CHROMOSOME:
                return this.validateYChromosomeAlleles(alleles);
            case LOCI_TYPES.X_CHROMOSOME:
                return this.validateXChromosomeAlleles(alleles);
            case LOCI_TYPES.SNP:
                return this.validateSNPAlleles(alleles);
            case LOCI_TYPES.AMELOGENIN:
                return this.validateAmelogeninAlleles(alleles);
            case LOCI_TYPES.INDEL:
                return this.validateIndelAlleles(alleles);
            default:
                // Basic validation for other types
                return this.validateGenericAlleles(alleles);
        }
    }

    /**
     * Validate STR alleles
     */
    validateSTRAlleles(alleles) {
        const result = { isValid: true, errors: [], warnings: [] };

        if (alleles.length > 2) {
            result.warnings.push('Обнаружено более 2 аллелей - возможна контаминация');
        }

        for (const allele of alleles) {
            // Allow *, **, ?, F, empty values, numeric alleles, decimal alleles, alleles with parentheses, and alleles with ? suffix (NO spaces allowed)
            if (allele !== '*' && allele !== '**' && allele !== '?' && allele !== 'F' && allele !== '' && 
                !/^\d+(\.\d+)?(\?)?(\(\d+(\.\d+)?\))?$/.test(allele)) {
                result.errors.push(`Недопустимый формат STR аллеля: ${allele}`);
                result.isValid = false;
            }
        }

        return result;
    }

    /**
     * Validate Y-chromosome alleles
     */
    validateYChromosomeAlleles(alleles) {
        const result = { isValid: true, errors: [], warnings: [] };

        if (alleles.length > 1) {
            result.warnings.push('Y-хромосомные маркеры должны иметь только один аллель');
        }

        for (const allele of alleles) {
            // Allow *, **, ?, F, empty values, numeric alleles, alleles with ? suffix (NO spaces allowed), and alleles with parentheses (e.g., "10(11)")
            if (allele !== '*' && allele !== '**' && allele !== '?' && allele !== 'F' && allele !== '' && 
                !/^\d+(\?)?(\(\d+\))?$/.test(allele)) {
                result.errors.push(`Недопустимый формат Y-хромосомного аллеля: ${allele}`);
                result.isValid = false;
            }
        }

        return result;
    }

    /**
     * Validate X-chromosome alleles
     */
    validateXChromosomeAlleles(alleles) {
        const result = { isValid: true, errors: [], warnings: [] };

        for (const allele of alleles) {
            // Allow *, **, ?, F, empty values, numeric alleles, and alleles with ? suffix (NO spaces allowed)
            if (allele !== '*' && allele !== '**' && allele !== '?' && allele !== 'F' && allele !== '' && !/^\d+(\.\d+)?(\?)?$/.test(allele)) {
                result.errors.push(`Недопустимый формат X-хромосомного аллеля: ${allele}`);
                result.isValid = false;
            }
        }

        return result;
    }

    /**
     * Validate SNP alleles
     */
    validateSNPAlleles(alleles) {
        const result = { isValid: true, errors: [], warnings: [] };

        if (alleles.length > 2) {
            result.warnings.push('Обнаружено более 2 аллелей для SNP - необычно');
        }

        for (const allele of alleles) {
            // Allow *, **, ?, F, empty values, A/T/C/G nucleotides, and any numeric values
            if (allele !== '*' && allele !== '**' && allele !== '?' && allele !== 'F' && allele !== '' && 
                !/^[ATCG]$/.test(allele.toUpperCase()) && !/^\d+(\.\d+)?$/.test(allele)) {
                result.errors.push(`Недопустимый SNP аллель: ${allele} (должен быть A, T, C, G, числовое значение, *, **, ?, F или пустым)`);
                result.isValid = false;
            }
        }

        return result;
    }

    /**
     * Validate Amelogenin alleles
     */
    validateAmelogeninAlleles(alleles) {
        const result = { isValid: true, errors: [], warnings: [] };

        for (const allele of alleles) {
            // Allow *, **, ?, F, empty values, X, Y, XY (combined), XX, YY, and patterns like X?, Y?, ?X, ?Y
            if (allele !== '*' && allele !== '**' && allele !== '?' && allele !== 'F' && allele !== '' && 
                !this.isValidAmelogeninPattern(allele)) {
                result.errors.push(`Недопустимый Amelogenin аллель: ${allele} (должен быть X, Y, XY, XX, YY, X?, Y?, ?X, ?Y, *, **, ?, F или пустым)`);
                result.isValid = false;
            }
        }

        return result;
    }

    /**
     * Check if an allele matches valid Amelogenin patterns
     */
    isValidAmelogeninPattern(allele) {
        // Convert Russian letters to English equivalents
        let normalizedAllele = allele.toUpperCase()
            .replace(/Х/g, 'X')  // Russian Х to English X
            .replace(/У/g, 'Y'); // Russian У to English Y (if needed)
        
        // Basic patterns
        if (['X', 'Y', 'XY', 'XX', 'YY'].includes(normalizedAllele)) {
            return true;
        }
        
        // Patterns with uncertainty markers
        if (/^[XY]\?$/.test(normalizedAllele) || /^\?[XY]$/.test(normalizedAllele)) {
            return true;
        }
        
        return false;
    }

    /**
     * Validate INDEL alleles
     */
    validateIndelAlleles(alleles) {
        const result = { isValid: true, errors: [], warnings: [] };

        for (const allele of alleles) {
            // Allow *, **, ?, F, empty values, and INDEL format
            if (allele !== '*' && allele !== '**' && allele !== '?' && allele !== 'F' && allele !== '' && !/^[+-]?\d*[ATCG]*$/.test(allele.toUpperCase())) {
                result.errors.push(`Недопустимый формат INDEL аллеля: ${allele}`);
                result.isValid = false;
            }
        }

        return result;
    }

    /**
     * Generic allele validation
     */
    validateGenericAlleles(alleles) {
        const result = { isValid: true, errors: [], warnings: [] };

        // Allow empty alleles and F (failure) for generic validation
        if (alleles.length === 0) {
            result.warnings.push('Аллели не предоставлены');
        }

        // Check for F (failure) values and add warning
        const failureCount = alleles.filter(allele => allele === 'F').length;
        if (failureCount > 0) {
            result.warnings.push(`${failureCount} аллель(ей) отмечены как неудачные (F)`);
        }

        return result;
    }

    /**
     * Get all supported loci
     * @returns {Array<string>} Array of all supported locus names
     */
    getAllSupportedLoci() {
        return [...ALL_LOCI];
    }

    /**
     * Get loci count by type
     * @returns {Object} Count of loci by type
     */
    getLociCountByType() {
        return {
            [LOCI_TYPES.STR]: STR_LOCI.length + PENTA_LOCI.length,
            [LOCI_TYPES.Y_CHROMOSOME]: Y_CHROMOSOME_LOCI.length,
            [LOCI_TYPES.X_CHROMOSOME]: X_CHROMOSOME_LOCI.length,
            [LOCI_TYPES.SNP]: SNP_LOCI.length,
            [LOCI_TYPES.AMELOGENIN]: AMELOGENIN_LOCI.length,
            [LOCI_TYPES.INDEL]: INDEL_LOCI.length,
            [LOCI_TYPES.OTHER]: OTHER_LOCI.length,
            total: ALL_LOCI.length
        };
    }
}

module.exports = {
    LociTypeDetector,
    LOCI_TYPES,
    STR_LOCI,
    Y_CHROMOSOME_LOCI,
    X_CHROMOSOME_LOCI,
    SNP_LOCI,
    AMELOGENIN_LOCI,
    INDEL_LOCI,
    PENTA_LOCI,
    OTHER_LOCI,
    ALL_LOCI
};