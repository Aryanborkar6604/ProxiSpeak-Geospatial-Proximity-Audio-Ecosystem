function createSpatialIndex(users, cellSize) {
  const cells = new Map();
  // Pack coordinates into a single 32-bit integer: eliminates string allocations & GC pressure
  const cellKey = (cx, cy) => ((cx + 32768) << 16) | ((cy + 32768) & 0xffff);

  for (let i = 0; i < users.length; i += 1) {
    const user = users[i];
    if (!user || !Array.isArray(user.location) || user.location.length < 2) continue;
    const x = user.location[0];
    const y = user.location[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const cx = Math.floor(x / cellSize);
    const cy = Math.floor(y / cellSize);
    const key = cellKey(cx, cy);
    let cell = cells.get(key);
    if (!cell) {
      cell = [];
      cells.set(key, cell);
    }
    cell.push(user);
  }

  return {
    nearby(x, y, radius) {
      const centerX = Math.floor(x / cellSize);
      const centerY = Math.floor(y / cellSize);
      const cellRange = Math.ceil(radius / cellSize);
      const radiusSq = radius * radius;
      const results = [];

      for (let offsetX = -cellRange; offsetX <= cellRange; offsetX += 1) {
        const cx = centerX + offsetX;
        for (let offsetY = -cellRange; offsetY <= cellRange; offsetY += 1) {
          const cy = centerY + offsetY;
          const cell = cells.get(cellKey(cx, cy));
          if (!cell) continue;

          for (let i = 0; i < cell.length; i += 1) {
            const user = cell[i];
            const loc = user.location;
            const dx = x - loc[0];
            const dy = y - loc[1];
            if (dx * dx + dy * dy <= radiusSq) {
              results.push(user);
            }
          }
        }
      }

      return results;
    },
  };
}

module.exports = { createSpatialIndex };
