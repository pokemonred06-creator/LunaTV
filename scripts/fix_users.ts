import fs from 'fs';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'data', 'db.json');

function main() {
  console.log('Starting user cleanup (Direct File Access)...');
  console.log(`DB Path: ${DB_FILE}`);

  if (!fs.existsSync(DB_FILE)) {
    console.log('DB file not found.');
    return;
  }

  try {
    const content = fs.readFileSync(DB_FILE, 'utf-8');
    const data = JSON.parse(content);

    const configKey = 'admin:config';
    const config = data[configKey];

    if (!config || !config.UserConfig || !config.UserConfig.Users) {
      console.log('No user config found in DB.');
      return;
    }

    const users = config.UserConfig.Users;
    const initialCount = users.length;
    console.log(`Initial user count: ${initialCount}`);

    interface User {
      username: string;
      [key: string]: unknown;
    }

    // Filter out users with empty or whitespace-only usernames
    const validUsers = users.filter(
      (u: User) => u.username && u.username.trim() !== '',
    );

    const newCount = validUsers.length;
    const removedCount = initialCount - newCount;

    if (removedCount > 0) {
      console.log(`Found ${removedCount} invalid users. Removing...`);
      config.UserConfig.Users = validUsers;
      data[configKey] = config;

      // Save back to file
      const tempFile = `${DB_FILE}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
      fs.renameSync(tempFile, DB_FILE);

      console.log('Cleanup complete. DB saved.');
    } else {
      console.log('No invalid users found.');
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

main();
