function getUserDisplayName(user) {
  return user?.display_name?.trim() || user?.username || 'Пользователь';
}
module.exports = { getUserDisplayName };
