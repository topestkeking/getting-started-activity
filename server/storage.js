import fs from 'fs';

const STORAGE_FILE = './storage.json';

export function getStorage() {
  if (!fs.existsSync(STORAGE_FILE)) {
    return {};
  }
  const data = fs.readFileSync(STORAGE_FILE);
  return JSON.parse(data);
}

export function saveStorage(data) {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2));
}

export function getUserData(userId) {
  const storage = getStorage();
  return storage[userId] || { wins: 0, matches: 0 };
}

export function updateUserData(userId, winsDelta, matchesDelta) {
  const storage = getStorage();
  const userData = storage[userId] || { wins: 0, matches: 0 };
  userData.wins += winsDelta;
  userData.matches += matchesDelta;
  storage[userId] = userData;
  saveStorage(storage);
  return userData;
}
