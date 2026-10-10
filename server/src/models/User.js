const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  avatarColor: { type: String, default: '#1FA896' },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);

