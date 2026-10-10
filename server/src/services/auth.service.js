const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');

async function loginUser({ email, name }) {
  let user = await User.findOne({ email });
  if (!user) {
    user = new User({
      userId: `usr_${Date.now()}`,
      email,
      name
    });
    await user.save();
  }
  
  const token = jwt.sign({ userId: user.userId, email: user.email }, env.JWT_SECRET, { expiresIn: '24h' });
  
  return { user, token };
}

module.exports = { loginUser };

