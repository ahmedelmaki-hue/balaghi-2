// Boundary reconstructed from the two connected Tripoli Center paths exported
// from the user's Google My Maps file. Coordinates are [longitude, latitude].
const TRIPOLI_CENTER_BOUNDARY = [
  [13.1604141, 32.8859759],
  [13.1721901, 32.9016584],
  [13.1759666, 32.9021196],
  [13.1896995, 32.89474],
  [13.206385, 32.900563],
  [13.2192253, 32.9022349],
  [13.2224525, 32.893241],
  [13.2205986, 32.8837271],
  [13.2238945, 32.8752215],
  [13.2251047, 32.8720785],
  [13.2225641, 32.8707809],
  [13.2171396, 32.8702618],
  [13.2167276, 32.8662824],
  [13.2102045, 32.8657057],
  [13.1957276, 32.8637314],
  [13.1928238, 32.8678108],
  [13.1797775, 32.867061],
  [13.1646713, 32.876],
  [13.1604141, 32.8859759],
];

function isPointInTripoliCenter(longitude, latitude) {
  const point = [longitude, latitude];
  let inside = false;
  for (let i = 0, j = TRIPOLI_CENTER_BOUNDARY.length - 1;
    i < TRIPOLI_CENTER_BOUNDARY.length; j = i, i += 1) {
    const [xi, yi] = TRIPOLI_CENTER_BOUNDARY[i];
    const [xj, yj] = TRIPOLI_CENTER_BOUNDARY[j];
    const cross = (point[1] - yi) * (xj - xi) - (point[0] - xi) * (yj - yi);
    const onSegment = Math.abs(cross) < 1e-9 &&
      point[0] >= Math.min(xi, xj) - 1e-9 && point[0] <= Math.max(xi, xj) + 1e-9 &&
      point[1] >= Math.min(yi, yj) - 1e-9 && point[1] <= Math.max(yi, yj) + 1e-9;
    if (onSegment) return true;
    const intersects = ((yi > point[1]) !== (yj > point[1])) &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

module.exports = { TRIPOLI_CENTER_BOUNDARY, isPointInTripoliCenter };
