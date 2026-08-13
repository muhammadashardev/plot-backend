function isValidCoordinate(latitude, longitude) {
  return Number.isFinite(Number(latitude))
    && Number.isFinite(Number(longitude))
    && Number(latitude) >= -90
    && Number(latitude) <= 90
    && Number(longitude) >= -180
    && Number(longitude) <= 180;
}

function distanceInKilometers(lat1, lng1, lat2, lng2) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees) => (Number(degrees) * Math.PI) / 180;
  const latitudeDifference = toRadians(Number(lat2) - Number(lat1));
  const longitudeDifference = toRadians(Number(lng2) - Number(lng1));
  const a = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2))
      * Math.sin(longitudeDifference / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function positiveNumber(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return maximum ? Math.min(number, maximum) : number;
}

module.exports = { distanceInKilometers, isValidCoordinate, positiveNumber };
