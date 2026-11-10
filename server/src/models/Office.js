const mongoose = require('mongoose');

const officeSchema = new mongoose.Schema({
  officeId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  width: { type: Number, default: 1000 },
  height: { type: Number, default: 700 },
  hearingRadiusPx: { type: Number, default: 100 },
  obstacles: [{
    type: { type: String, default: 'wall' },
    x1: Number, y1: Number, x2: Number, y2: Number,
    attenuation: { type: Number, default: 0.9 }
  }],
  zones: [{
    name: String,
    shape: { type: String, default: 'rect' },
    x: Number, y: Number, w: Number, h: Number
  }]
}, { timestamps: true });

module.exports = mongoose.model('Office', officeSchema);

