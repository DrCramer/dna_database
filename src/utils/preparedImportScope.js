// A prepared file is an in-memory transfer, scoped to the account that produced it.
function preparedImportMatches(prepared, user) {
  return Boolean(prepared?.file && user?.id && prepared.ownerId === user.id &&
    (!prepared.organizationId || prepared.organizationId === user.organization_id));
}
module.exports = { preparedImportMatches };
