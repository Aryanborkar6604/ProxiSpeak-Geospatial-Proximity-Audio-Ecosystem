const mongoose = require('mongoose');

const positionSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  officeId: { type: String, required: true },
  location: {
    type: [Number], // [x, y]
    required: true,
  },
  isOnline: { type: Boolean, default: true },
  isMuted: { type: Boolean, default: false }
}, { timestamps: true });

// 2d index on location for geospatial queries with pixel bounds (0-2000px)
positionSchema.index({ location: '2d' }, { min: -5000, max: 5000 });

module.exports = mongoose.model('Position', positionSchema);

