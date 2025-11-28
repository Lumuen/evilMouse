<template>
  <view class="container">
    <!-- 速度显示 -->
    <view class="speed-circle">
      <text class="speed-value">{{ speed }}</text>
      <text class="speed-unit">km/h</text>
    </view>
    
    <!-- 状态与模式 -->
    <view class="status-box">
      <text class="status-text">{{ status }}</text>
      <text class="mode-text">模式: {{ currentMode === 'cycling' ? '骑行（防过滤）' : '普通' }} | 定位间隔: 3秒</text>
    </view>
    
    <!-- 模式切换（骑行/普通） -->
    <view class="mode-switch">
      <button 
        :class="['mode-btn', currentMode === 'cycling' ? 'active' : '']"
        @click="changeMode('cycling')"
      >
        骑行模式
      </button>
      <button 
        :class="['mode-btn', currentMode === 'normal' ? 'active' : '']"
        @click="changeMode('normal')"
      >
        普通模式
      </button>
    </view>
    
    <!-- 控制按钮 -->
    <view class="control-buttons">
      <button 
        class="control-btn start-btn" 
        :disabled="isMonitoring"
        @click="startMonitoring"
      >
        {{ isMonitoring ? '监控中...' : '开始监控' }}
      </button>
      <button 
        class="control-btn stop-btn" 
        :disabled="!isMonitoring"
        @click="stopMonitoring"
      >
        停止监控
      </button>
      <button 
        class="control-btn reset-btn" 
        @click="resetMeasurement"
      >
        重置
      </button>
    </view>
    
    <!-- 数据详情 -->
    <view class="info-box" v-if="isMonitoring">
      <text class="info-title">数据详情</text>
      <text class="info-text">定位精度: ±{{ accuracy || '--' }}米</text>
      <text class="info-text">方向变化: {{ directionChange || '--' }}°</text>
      <text class="info-text">原始速度: {{ rawSpeed || '--' }} km/h</text>
      <text class="info-text">下次更新: {{ nextUpdateTime || '--' }}秒后</text>
    </view>
  </view>
</template>

<script>
import { calculateDistance, calculateBearing, dynamicSmoothing } from '@/utils/amap.js';

export default {
  data() {
    return {
      speed: '0.0',               // 最终显示速度（km/h）
      isMonitoring: false,        // 是否监控中
      status: '准备就绪',         // 状态提示
      currentMode: 'cycling',     // 默认骑行模式（防过滤）
      currentLocation: null,      // 当前定位点
      lastLocation: null,         // 上一次定位点
      lastBearing: 0,             // 上一次方向角
      directionChange: 0,         // 方向变化量（度）
      accuracy: null,             // 当前定位精度（米）
      rawSpeed: '0.0',            // 原始计算速度（未平滑）
      locationListener: null,     // 定位监听器
      locationTimer: null,        // 定位间隔定时器（3秒）
      nextUpdateTime: 3,          // 下次更新倒计时（秒）
      minMoveDistance: 1,         // 最小移动距离（米，3秒间隔下放宽）
      stopThreshold: 0.5,         // 静止阈值（km/h，低于归0）
    };
  },
  
  methods: {
    // 1. 开始监控
    async startMonitoring() {
      this.status = '请求定位权限...';
      try {
        await this.requestLocationPermission();
        this.startLocationTracking();
      } catch (err) {
        this.status = `启动失败: ${err.message}`;
        uni.showToast({ title: this.status, icon: 'none', duration: 2000 });
      }
    },
    
    // 2. 请求定位权限
    requestLocationPermission() {
      return new Promise((resolve, reject) => {
        if (uni.getAppAuthorizeSetting) {
          const auth = uni.getAppAuthorizeSetting();
          switch (auth.locationAuthorized) {
            case 'authorized':
              resolve();
              break;
            case 'not determined':
              uni.getLocation({ type: 'gcj02', success: resolve, fail: reject });
              break;
            default:
              uni.showModal({
                title: '需要定位权限',
                content: '请在设置中开启定位权限以使用速度监控',
                confirmText: '去设置',
                success: (res) => {
                  res.confirm ? uni.openAppAuthorizeSetting() : reject(new Error('未授权定位权限'));
                }
              });
          }
        } else {
          uni.getLocation({ type: 'gcj02', success: resolve, fail: reject });
        }
      });
    },
    
    // 3. 启动定位（3秒间隔，通过定时器控制）
    startLocationTracking() {
      this.isMonitoring = true;
      this.resetMeasurement();
      this.status = '监控中...';
      
      // 立即执行一次定位，避免初始延迟
      this.getLocationOnce();
      
      // 启动3秒间隔定时器（控制定位频率）
      this.locationTimer = setInterval(() => {
        this.getLocationOnce();
      }, 3000); // 3000ms = 3秒
      
      // 启动倒计时更新（提升用户感知）
      this.startUpdateTimer();
      
      uni.setKeepScreenOn({ keepScreenOn: true });
    },
    
    // 4. 单次定位获取（核心：避免高频调用）
    getLocationOnce() {
      uni.getLocation({
        type: 'gcj02',
        highAccuracyExpireTime: 3000, // 高精度维持3秒，匹配定位间隔
        success: (location) => {
          this.currentLocation = location;
          this.accuracy = Math.round(location.accuracy);
          this.calculateRealTimeSpeed(); // 计算当前速度
          this.nextUpdateTime = 3; // 重置倒计时
        },
        fail: (err) => {
          console.error('定位失败:', err);
          this.status = `定位失败: ${err.errMsg}`;
          this.nextUpdateTime = 3;
        }
      });
    },
    
    // 5. 实时计算速度（算法不变，适配3秒间隔）
    calculateRealTimeSpeed() {
      const current = this.currentLocation;
      let currentSpeed = 0;
      
      // 优先用定位原生速度（3秒间隔下依然实时）
      if (current.speed !== undefined && current.speed > 0) {
        currentSpeed = current.speed * 3.6; // m/s → km/h
      }
      
      // 原生速度无效时，用3秒间隔的坐标计算（距离更准确）
      if ((currentSpeed <= 0 || !currentSpeed) && this.lastLocation) {
        const distance = calculateDistance(this.lastLocation, current);
        const timeDiff = (current.timestamp - this.lastLocation.timestamp) / 1000; // 秒（约3秒）
        
        // 3秒间隔下，移动距离<1米视为静止/抖动
        if (distance >= this.minMoveDistance && timeDiff > 0) {
          currentSpeed = (distance / timeDiff) * 3.6;
        }
      }
      
      // 计算方向变化（转向判断不变）
      if (this.lastLocation) {
        const currentBearing = calculateBearing(this.lastLocation, current);
        this.directionChange = Math.abs(currentBearing - this.lastBearing);
        this.directionChange = this.directionChange > 180 ? 360 - this.directionChange : this.directionChange;
        this.lastBearing = currentBearing;
      }
      
      // 骑行模式：放宽精度过滤（80米），普通模式50米
      const isLowAccuracy = this.currentMode === 'cycling' ? this.accuracy > 80 : this.accuracy > 50;
      if (isLowAccuracy) {
        this.rawSpeed = currentSpeed.toFixed(1);
        return;
      }
      
      // 动态平滑（解决转向骤降、停止不归零）
      const lastSpeed = parseFloat(this.speed);
      const smoothedSpeed = dynamicSmoothing(lastSpeed, currentSpeed, this.directionChange, this.accuracy);
      
      // 更新显示数据
      this.rawSpeed = currentSpeed.toFixed(1);
      this.speed = smoothedSpeed.toFixed(1);
      
      // 更新状态文本
      this.updateStatus();
      
      // 保存当前定位为下次计算的“上一次”
      this.lastLocation = { ...current };
    },
    
    // 6. 更新状态提示
    updateStatus() {
      const currentSpeed = parseFloat(this.speed);
      if (currentSpeed < this.stopThreshold) {
        this.status = '当前状态: 静止';
      } else if (this.directionChange > 30) {
        this.status = `当前状态: 转向中（速度: ${this.speed} km/h）`;
      } else {
        this.status = `当前速度: ${this.speed} km/h`;
      }
    },
    
    // 7. 启动下次更新倒计时（提升用户感知）
    startUpdateTimer() {
      // 清除原有定时器（避免叠加）
      if (this.updateTimer) clearInterval(this.updateTimer);
      
      this.updateTimer = setInterval(() => {
        if (this.nextUpdateTime > 0) {
          this.nextUpdateTime--;
        } else {
          this.nextUpdateTime = 3;
        }
      }, 1000); // 1秒更新一次倒计时
    },
    
    // 8. 切换模式（骑行/普通）
    changeMode(mode) {
      this.currentMode = mode;
      this.status = mode === 'cycling' ? '已切换骑行模式（防数据过滤）' : '已切换普通模式';
    },
    
    // 9. 重置测量
    resetMeasurement() {
      this.speed = '0.0';
      this.rawSpeed = '0.0';
      this.lastLocation = null;
      this.lastBearing = 0;
      this.directionChange = 0;
      this.nextUpdateTime = 3;
      this.status = this.isMonitoring ? '监控中...' : '准备就绪';
    },
    
    // 10. 停止监控（清除所有定时器）
    stopMonitoring() {
      // 清除定位和倒计时定时器
      if (this.locationTimer) clearInterval(this.locationTimer);
      if (this.updateTimer) clearInterval(this.updateTimer);
      
      this.isMonitoring = false;
      this.status = '已停止监控';
      uni.setKeepScreenOn({ keepScreenOn: false });
      uni.showToast({ title: '已停止', icon: 'success', duration: 1000 });
    }
  },
  
  // 页面卸载时彻底清除定时器
  onUnload() {
    if (this.locationTimer) clearInterval(this.locationTimer);
    if (this.updateTimer) clearInterval(this.updateTimer);
    if (this.isMonitoring) this.stopMonitoring();
  }
};
</script>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40rpx;
  min-height: 100vh;
  background: linear-gradient(135deg, #2c3e50 0%, #000000 100%);
}

.speed-circle {
  width: 400rpx;
  height: 400rpx;
  border: 10rpx solid #3498db;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin: 40rpx 0;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  box-shadow: 0 0 30rpx rgba(52, 152, 219, 0.5);
}

.speed-value {
  font-size: 120rpx;
  font-weight: bold;
  color: #3498db;
  text-shadow: 0 0 20rpx rgba(52, 152, 219, 0.8);
}

.speed-unit {
  font-size: 40rpx;
  color: rgba(255, 255, 255, 0.8);
  margin-top: 10rpx;
}

.status-box {
  background: rgba(255, 255, 255, 0.1);
  padding: 25rpx;
  border-radius: 20rpx;
  margin: 10rpx 0;
  width: 100%;
  max-width: 600rpx;
  backdrop-filter: blur(10px);
  text-align: center;
}

.status-text {
  color: #ecf0f1;
  font-size: 32rpx;
  display: block;
}

.mode-text {
  color: rgba(255, 255, 255, 0.7);
  font-size: 24rpx;
  display: block;
  margin-top: 10rpx;
}

.mode-switch {
  display: flex;
  gap: 20rpx;
  width: 100%;
  max-width: 600rpx;
  margin: 20rpx 0;
}

.mode-btn {
  flex: 1;
  padding: 20rpx 0;
  font-size: 28rpx;
  border-radius: 15rpx;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: #ccc;
}

.mode-btn.active {
  background: #2ecc71;
  color: #fff;
}

.control-buttons {
  display: flex;
  gap: 20rpx;
  margin: 20rpx 0;
  width: 100%;
  max-width: 600rpx;
}

.control-btn {
  flex: 1;
  padding: 25rpx;
  border-radius: 15rpx;
  font-size: 32rpx;
  border: none;
  transition: all 0.3s;
}

.start-btn {
  background: #2ecc71;
  color: white;
}

.start-btn:disabled {
  background: #7f8c8d;
}

.stop-btn {
  background: #e74c3c;
  color: white;
}

.stop-btn:disabled {
  background: #7f8c8d;
}

.reset-btn {
  background: #f39c12;
  color: white;
}

.info-box {
  background: rgba(255, 255, 255, 0.05);
  padding: 25rpx;
  border-radius: 15rpx;
  margin-top: 30rpx;
  width: 100%;
  max-width: 600rpx;
  backdrop-filter: blur(10px);
}

.info-title {
  color: #bdc3c7;
  font-size: 32rpx;
  display: block;
  margin-bottom: 15rpx;
  text-align: center;
}

.info-text {
  color: rgba(255, 255, 255, 0.7);
  font-size: 28rpx;
  display: block;
  margin: 10rpx 0;
}
</style>