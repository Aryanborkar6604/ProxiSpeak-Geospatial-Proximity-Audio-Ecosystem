require('dotenv').config();

const env = {
  PORT: process.env.PORT || 4000,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  CLIENT_URL: process.env.CLIENT_URL,
};

if (!env.MONGODB_URI || !env.JWT_SECRET || !env.CLIENT_URL) {
  console.error("Missing required environment variables.");
  process.exit(1);
}

module.exports = env;

