/* eslint-disable @typescript-eslint/no-explicit-any,no-console */
import he from 'he';
import Hls from 'hls.js';

function getDoubanImageProxyConfig(): {
  proxyType:
  | 'direct'
  | 'server'
  | 'img3'
  | 'cmliussss-cdn-tencent'
  | 'cmliussss-cdn-ali'
  | 'custom';
  proxyUrl: string;
} {
  const doubanImageProxyType =
    localStorage.getItem('doubanImageProxyType') ||
    (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE ||
    'cmliussss-cdn-tencent';
  const doubanImageProxy =
    localStorage.getItem('doubanImageProxyUrl') ||
    (window as any).RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY ||
    '';
  return {
    proxyType: doubanImageProxyType,
    proxyUrl: doubanImageProxy,
  };
}

/**
 * 处理图片 URL，如果设置了图片代理则使用代理
 */
export function processImageUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;

  // 仅处理豆瓣图片代理
  if (!originalUrl.includes('doubanio.com')) {
    return originalUrl;
  }

  const { proxyType, proxyUrl } = getDoubanImageProxyConfig();
  switch (proxyType) {
    case 'server':
      return `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;
    case 'img3':
      return originalUrl.replace(/img\d+\.doubanio\.com/g, 'img3.doubanio.com');
    case 'cmliussss-cdn-tencent':
      return originalUrl.replace(
        /img\d+\.doubanio\.com/g,
        'img.doubanio.cmliussss.net'
      );
    case 'cmliussss-cdn-ali':
      return originalUrl.replace(
        /img\d+\.doubanio\.com/g,
        'img.doubanio.cmliussss.com'
      );
    case 'custom':
      return `${proxyUrl}${encodeURIComponent(originalUrl)}`;
    case 'direct':
    default:
      return originalUrl;
  }
}

/**
 * 从M3U8文本中解析视频分辨率
 * 查找 #EXT-X-STREAM-INF 中的 RESOLUTION=WxH 标签
 */
function parseQualityFromM3U8(content: string): string {
  // 查找所有 RESOLUTION= 标签，选择最高分辨率
  const resMatches = Array.from(content.matchAll(/RESOLUTION=(\d+)x(\d+)/g));
  let maxWidth = 0;

  for (const match of resMatches) {
    const width = parseInt(match[1]);
    if (width > maxWidth) {
      maxWidth = width;
    }
  }

  if (maxWidth === 0) {
    return '未知';
  }

  // 根据视频宽度判断视频质量等级
  return maxWidth >= 3840
    ? '4K'
    : maxWidth >= 2560
      ? '2K'
      : maxWidth >= 1920
        ? '1080p'
        : maxWidth >= 1280
          ? '720p'
          : maxWidth >= 854
            ? '480p'
            : 'SD';
}

/**
 * 快速获取视频分辨率（通过解析M3U8文本）
 * 不需要创建video元素或加载HLS.js，速度快5-10倍
 */
async function getVideoResolutionFast(m3u8Url: string): Promise<{
  quality: string;
  loadSpeed: string;
  pingTime: number;
}> {
  const startTime = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);

  try {
    const response = await fetch(m3u8Url, {
      signal: controller.signal,
      cache: 'no-store', // 强制刷新以测试真实速度
    });

    const pingTime = performance.now() - startTime;
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    const loadTime = performance.now() - startTime;
    const size = new Blob([text]).size;

    // 计算下载速度
    const speedKBps = size / 1024 / (loadTime / 1000);
    const loadSpeed =
      speedKBps >= 1024
        ? `${(speedKBps / 1024).toFixed(1)} MB/s`
        : `${speedKBps.toFixed(1)} KB/s`;

    // 从M3U8内容解析分辨率
    const quality = parseQualityFromM3U8(text);

    return {
      quality,
      loadSpeed,
      pingTime: Math.round(pingTime),
    };
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/**
 * 使用HLS.js获取视频分辨率（慢速但准确）
 * 通过实际加载视频片段获取真实分辨率
 */
async function getVideoResolutionWithHls(m3u8Url: string): Promise<{
  quality: string;
  loadSpeed: string;
  pingTime: number;
}> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';

    // 测量网络延迟
    const pingStart = performance.now();
    let pingTime = 0;

    fetch(m3u8Url, { method: 'HEAD', mode: 'no-cors' })
      .then(() => {
        pingTime = performance.now() - pingStart;
      })
      .catch(() => {
        pingTime = performance.now() - pingStart;
      });

    const hls = new Hls();

    // 设置超时处理
    const timeout = setTimeout(() => {
      hls.destroy();
      video.remove();
      reject(new Error('Timeout loading video metadata'));
    }, 5000);

    video.onerror = () => {
      clearTimeout(timeout);
      hls.destroy();
      video.remove();
      reject(new Error('Failed to load video metadata'));
    };

    let actualLoadSpeed = '未知';
    let hasSpeedCalculated = false;
    let hasMetadataLoaded = false;
    let fragmentStartTime = 0;

    const checkAndResolve = () => {
      if (
        hasMetadataLoaded &&
        (hasSpeedCalculated || actualLoadSpeed !== '未知')
      ) {
        clearTimeout(timeout);
        const width = video.videoWidth;
        if (width && width > 0) {
          hls.destroy();
          video.remove();

          const quality =
            width >= 3840
              ? '4K'
              : width >= 2560
                ? '2K'
                : width >= 1920
                  ? '1080p'
                  : width >= 1280
                    ? '720p'
                    : width >= 854
                      ? '480p'
                      : 'SD';

          resolve({
            quality,
            loadSpeed: actualLoadSpeed,
            pingTime: Math.round(pingTime),
          });
        } else {
          resolve({
            quality: '未知',
            loadSpeed: actualLoadSpeed,
            pingTime: Math.round(pingTime),
          });
        }
      }
    };

    hls.on(Hls.Events.FRAG_LOADING, () => {
      fragmentStartTime = performance.now();
    });

    hls.on(Hls.Events.FRAG_LOADED, (event: any, data: any) => {
      if (
        fragmentStartTime > 0 &&
        data &&
        data.payload &&
        !hasSpeedCalculated
      ) {
        const loadTime = performance.now() - fragmentStartTime;
        const size = data.payload.byteLength || 0;

        if (loadTime > 0 && size > 0) {
          const speedKBps = size / 1024 / (loadTime / 1000);

          if (speedKBps >= 1024) {
            actualLoadSpeed = `${(speedKBps / 1024).toFixed(1)} MB/s`;
          } else {
            actualLoadSpeed = `${speedKBps.toFixed(1)} KB/s`;
          }
          hasSpeedCalculated = true;
          checkAndResolve();
        }
      }
    });

    hls.loadSource(m3u8Url);
    hls.attachMedia(video);

    hls.on(Hls.Events.ERROR, (event: any, data: any) => {
      console.error('HLS错误:', data);
      if (data.fatal) {
        clearTimeout(timeout);
        hls.destroy();
        video.remove();
        reject(new Error(`HLS播放失败: ${data.type}`));
      }
    });

    video.onloadedmetadata = () => {
      hasMetadataLoaded = true;
      checkAndResolve();
    };
  });
}

/**
 * 从m3u8地址获取视频质量等级和网络信息
 * 使用混合策略：先尝试快速M3U8文本解析，如果没有分辨率标签则回退到HLS.js方法
 * @param m3u8Url m3u8播放列表的URL
 * @returns Promise<{quality: string, loadSpeed: string, pingTime: number}> 视频质量等级和网络信息
 */
export async function getVideoResolutionFromM3u8(m3u8Url: string): Promise<{
  quality: string; // 如720p、1080p等
  loadSpeed: string; // 自动转换为KB/s或MB/s
  pingTime: number; // 网络延迟（毫秒）
}> {
  // 直接使用 HLS 方法，以确保测速准确（需要下载真实分片）
  // 之前的 Fast 方法只下载文本文件，导致测速结果极低且不准确
  return await getVideoResolutionWithHls(m3u8Url);
}

export function cleanHtmlTags(text: string): string {
  if (!text) return '';

  const cleanedText = text
    .replace(/<[^>]+>/g, '\n') // 将 HTML 标签替换为换行
    .replace(/\n+/g, '\n') // 将多个连续换行合并为一个
    .replace(/[ \t]+/g, ' ') // 将多个连续空格和制表符合并为一个空格，但保留换行符
    .replace(/^\n+|\n+$/g, '') // 去掉首尾换行
    .trim(); // 去掉首尾空格

  // 使用 he 库解码 HTML 实体
  return he.decode(cleanedText);
}
