const { alleleTokens, informativeAlleles } = require('./alleleTokens');
const { equalAlleleArrays } = require('./alleleComparison');

function prepareLocusData(value) {
  const parts = informativeAlleles(value);
  return { parts, partsSet: new Set(parts), isHomozygote: parts.length === 2 && parts[0] === parts[1],
    exactComparable: parts.length > 0 && parts.length === alleleTokens(value).length,
    exactSignature: JSON.stringify([...parts].sort()) };
}

function isExactLocusMatch(first, second) {
  if (!first || !second || first.exactComparable === false || second.exactComparable === false || !first.parts.length || !second.parts.length) return false;
  // Одиночная запись и повтор одной аллели эквивалентны, но не входят в гетерозиготу/смесь.
  if (first.partsSet.size === 1 && second.partsSet.size === 1) return first.parts[0] === second.parts[0];
  if (first.exactSignature != null && second.exactSignature != null) return first.exactSignature === second.exactSignature;
  return equalAlleleArrays(first.parts, second.parts);
}

module.exports = { prepareLocusData, isExactLocusMatch };
