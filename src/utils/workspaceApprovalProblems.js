function groupApprovalProblems(problems) {
  const groups = new Map();
  for (const { code, message, instruction, profileId, objectNumber, year, expertiseType } of problems) {
    const key = JSON.stringify([code, message, instruction]);
    if (!groups.has(key)) groups.set(key, { code, message, instruction, profiles: [] });
    groups.get(key).profiles.push({ profileId, objectNumber, year, expertiseType });
  }
  return [...groups.values()];
}

module.exports = { groupApprovalProblems };
