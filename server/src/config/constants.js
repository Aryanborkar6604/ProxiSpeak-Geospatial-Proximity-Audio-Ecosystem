module.exports = {
  HEARING_RADIUS_PX: 100,
  POSITION_UPDATE_THROTTLE_MS: 1000 / 15, // ~15Hz
  POSITION_PERSIST_INTERVAL_MS: 1000, // Persist at most once per second per user.
  PROXIMITY_RECOMPUTE_INTERVAL_MS: 1000 / 10, // ~10Hz
};
