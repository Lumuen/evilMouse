// utils/amap.js
/**
 * 1. 计算两点间距离（哈弗辛公式）
 * @param {Object} p1 - {latitude, longitude}
 * @param {Object} p2 - {latitude, longitude}
 * @return {Number} 距离（米）
 */
export function calculateDistance(p1, p2) {
  const R = 6371000; // 地球半径（米）
  const dLat = (p2.latitude - p1.latitude) * Math.PI / 180;
  const dLon = (p2.longitude - p1.longitude) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(p1.latitude * Math.PI / 180) * Math.cos(p2.latitude * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}

/**
 * 2. 计算两点间方向角（用于判断转向）
 * @param {Object} p1 - 起点 {latitude, longitude}
 * @param {Object} p2 - 终点 {latitude, longitude}
 * @return {Number} 方向角（0-360度）
 */
export function calculateBearing(p1, p2) {
  const dLon = (p2.longitude - p1.longitude) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(p2.latitude * Math.PI / 180);
  const x = Math.cos(p1.latitude * Math.PI / 180) * Math.sin(p2.latitude * Math.PI / 180) - 
            Math.sin(p1.latitude * Math.PI / 180) * Math.cos(p2.latitude * Math.PI / 180) * Math.cos(dLon);
  
  let bearing = Math.atan2(y, x) * 180 / Math.PI;
  return bearing < 0 ? bearing + 360 : bearing; // 转为0-360度
}

/**
 * 3. 动态平滑算法（根据速度、方向、精度调整权重）
 * @param {Number} lastSpeed - 上一次速度
 * @param {Number} currentSpeed - 当前计算速度
 * @param {Number} directionChange - 方向变化量（度）
 * @param {Number} accuracy - 当前定位精度（米）
 * @return {Number} 平滑后速度
 */
export function dynamicSmoothing(lastSpeed, currentSpeed, directionChange, accuracy) {
  // 方向变化大（>30度）→ 降低当前速度权重，避免转向骤降
  let directionWeight = directionChange > 30 ? 0.2 : 0.5;
  
  // 精度差（>50米）→ 降低当前速度权重，避免干扰
  let accuracyWeight = accuracy > 50 ? 0.1 : directionWeight;
  
  // 静止时（<0.5km/h）→ 直接归0，解决停止不归零
  if (currentSpeed < 0.5) return 0;
  
  // 动态权重平滑（避免固定权重的延迟）
  return lastSpeed * (1 - accuracyWeight) + currentSpeed * accuracyWeight;
}