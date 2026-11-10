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

// Compound 2d index supports office-scoped $near and $geoWithin lookups.
positionSchema.index(
  { officeId: 1, isOnline: 1, location: '2d' },
  { min: -5000, max: 5000, name: 'office_online_location_2d' },
);

module.exports = mongoose.model('Position', positionSchema);
