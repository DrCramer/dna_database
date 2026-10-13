// Операции сравнения без нормализации: её правила остаются у вызывающего алгоритма.
function equalSets(first, second) {
  return first.size === second.size && [...first].every(value => second.has(value));
}

function isAlleleSubset(first, second) {
  const values = second instanceof Set ? second : new Set(second);
  return [...first].every(value => values.has(value));
}

function setIntersection(first, second) {
  return new Set([...first].filter(value => second.has(value)));
}

function hasIntersection(first, second) {
  const values = second instanceof Set ? second : new Set(second);
  return [...first].some(value => values.has(value));
}

function equalAlleleArrays(first, second) {
  if (first.length !== second.length) return false;
  const sortedFirst = [...first].sort(), sortedSecond = [...second].sort();
  return sortedFirst.every((value, index) => value === sortedSecond[index]);
}

// Сохраняет кратность аллелей и порядок первого массива.
function multisetIntersection(first, second) {
  const remaining = [...second], result = [];
  for (const value of first) {
    const index = remaining.indexOf(value);
    if (index !== -1) { result.push(value); remaining.splice(index, 1); }
  }
  return result;
}

// Исторический фильтр байесовского детектора. Спецтокены здесь не меняются (MATH-04).
function nonEmptyNonSexAlleles(alleles) {
  return alleles.filter(allele => allele !== null && allele !== undefined && allele !== '' && !['X', 'Y'].includes(allele));
}

module.exports = { equalSets, isAlleleSubset, setIntersection, hasIntersection, equalAlleleArrays, multisetIntersection, nonEmptyNonSexAlleles };
