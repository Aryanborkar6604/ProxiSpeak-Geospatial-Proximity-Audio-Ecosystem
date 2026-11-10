const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  isActive: { type: Boolean, default: true },
  avatarColor: { type: String, default: '#1FA896' },
  lastLoginAt: { type: Date, default: null },
}, { timestamps: true });
// A user's presence in the shared virtual office.
// position is [x, y] on a flat 2D floor plan, so we use a "2d" index
// (legacy coordinate pairs) instead of a spherical 2dsphere index.
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    socketId: { type: String, index: true },
    online: { type: Boolean, default: false },
    position: { type: [Number], default: [0, 0], index: '2d' },
    lastSeen: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Find users within `radius` units of [x, y].
userSchema.statics.findNearby = function (x, y, radius) {
  return this.find({
    online: true,
    position: { $geoWithin: { $center: [[x, y], radius] } },
  });
};

module.exports = mongoose.model('User', userSchema);
