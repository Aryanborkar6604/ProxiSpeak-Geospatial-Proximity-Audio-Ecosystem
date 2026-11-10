function createSpatialIndex(users, cellSize) {
  const cells = new Map();
  const cellKey = (x, y) => `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;

  for (const user of users) {
    if (!Array.isArray(user.location) || user.location.length < 2) continue;
    const [x, y] = user.location;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const key = cellKey(x, y);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(user);
  }

  return {
    nearby(x, y, radius) {
      const centerX = Math.floor(x / cellSize);
      const centerY = Math.floor(y / cellSize);
      const cellRange = Math.ceil(radius / cellSize);
      const candidates = [];

      for (let offsetX = -cellRange; offsetX <= cellRange; offsetX += 1) {
        for (let offsetY = -cellRange; offsetY <= cellRange; offsetY += 1) {
          candidates.push(...(cells.get(`${centerX + offsetX}:${centerY + offsetY}`) || []));
        }
      }

      return candidates.filter((user) => {
        const [peerX, peerY] = user.location;
        return Math.hypot(x - peerX, y - peerY) <= radius;
      });
    },
  };
}

module.exports = { createSpatialIndex };
