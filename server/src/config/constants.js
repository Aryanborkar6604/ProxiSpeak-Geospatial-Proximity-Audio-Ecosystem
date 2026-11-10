module.exports = {
  HEARING_RADIUS_PX: 100,
  POSITION_UPDATE_THROTTLE_MS: 1000 / 20, // ~20Hz
  POSITION_PERSIST_INTERVAL_MS: 2000, // Persist at most once per 2 seconds per user (less DB chatter)
  PROXIMITY_RECOMPUTE_INTERVAL_MS: 1000 / 20, // 20Hz – snappier range/exit events
};
