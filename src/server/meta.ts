import { MetaConfig, MetaRateLimitInfo } from '../types.js';
import { addLog, saveRateLimits } from './db.js';

// Parse Meta Graph API Rate Limit Headers
function parseRateLimitHeaders(headers: Headers): MetaRateLimitInfo | null {
  const appUsageStr = headers.get('x-app-usage');
  const bizUsageStr = headers.get('x-business-use-case-usage');

  if (!appUsageStr && !bizUsageStr) {
    return null;
  }

  const currentLimits: MetaRateLimitInfo = {
    appCallCount: 0,
    appCpuTime: 0,
    appTotalTime: 0,
    businessCallCount: 0,
    businessCpuTime: 0,
    businessTotalTime: 0,
    estimatedTimeToRegainAccess: 0,
    updatedAt: Date.now()
  };

  if (appUsageStr) {
    try {
      const appUsage = JSON.parse(appUsageStr);
      currentLimits.appCallCount = appUsage.call_count ?? 0;
      currentLimits.appCpuTime = appUsage.total_cputime ?? 0;
      currentLimits.appTotalTime = appUsage.total_time ?? 0;
    } catch (e) {
      console.error('Failed to parse x-app-usage header:', e);
    }
  }

  if (bizUsageStr) {
    try {
      const bizUsage = JSON.parse(bizUsageStr);
      for (const key of Object.keys(bizUsage)) {
        const list = bizUsage[key];
        if (Array.isArray(list) && list.length > 0) {
          const item = list[0];
          currentLimits.businessCallCount = Math.max(currentLimits.businessCallCount, item.call_count ?? 0);
          currentLimits.businessCpuTime = Math.max(currentLimits.businessCpuTime, item.total_cputime ?? 0);
          currentLimits.businessTotalTime = Math.max(currentLimits.businessTotalTime, item.total_time ?? 0);
          currentLimits.estimatedTimeToRegainAccess = Math.max(
            currentLimits.estimatedTimeToRegainAccess,
            item.estimated_time_to_regain_access ?? 0
          );
        }
      }
    } catch (e) {
      console.error('Failed to parse x-business-use-case-usage header:', e);
    }
  }

  return currentLimits;
}

// Meta Graph API base helper
async function callMetaApi(
  version: string,
  path: string,
  method: 'GET' | 'POST',
  params: Record<string, string>,
  accessToken: string
) {
  let url = `https://graph.facebook.com/${version}/${path}`;
  const options: RequestInit = { method };

  if (method === 'GET') {
    const urlParams = new URLSearchParams({
      ...params,
      access_token: accessToken,
    });
    url = `${url}?${urlParams.toString()}`;
  } else {
    // POST request: send parameters in the request body to fully support long captions, emojis and hashtags
    const bodyParams = new URLSearchParams({
      ...params,
      access_token: accessToken,
    });
    options.body = bodyParams.toString();
    options.headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
  }

  const response = await fetch(url, options);

  // Try to parse rate limits from response headers
  try {
    const rateLimits = parseRateLimitHeaders(response.headers);
    if (rateLimits) {
      saveRateLimits(rateLimits);
    }
  } catch (err) {
    console.error('Failed to parse and save Meta API rate limits:', err);
  }

  const data = await response.json();

  if (!response.ok) {
    const errorDetails = data.error || { message: 'Unknown Meta API Error' };
    throw {
      message: errorDetails.message,
      code: errorDetails.code,
      subcode: errorDetails.error_subcode,
      type: errorDetails.type,
      raw: data,
    };
  }

  return data;
}

export interface MetaConnectionVerifyResult {
  success: boolean;
  username?: string;
  name?: string;
  profilePictureUrl?: string;
  error?: string;
}

export async function verifyMetaConnection(config: MetaConfig): Promise<MetaConnectionVerifyResult> {
  const logRequest = `GET /${config.instagramBusinessAccountId}?fields=id,name,username,profile_picture_url`;
  addLog({
    action: 'META_VERIFY',
    status: 'info',
    apiRequest: logRequest
  });

  try {
    const data = await callMetaApi(
      config.graphApiVersion,
      config.instagramBusinessAccountId,
      'GET',
      { fields: 'id,name,username,profile_picture_url' },
      config.accessToken
    );

    addLog({
      action: 'META_VERIFY',
      status: 'success',
      apiResponse: JSON.stringify(data)
    });

    return {
      success: true,
      username: data.username,
      name: data.name,
      profilePictureUrl: data.profile_picture_url,
    };
  } catch (err: any) {
    const errMsg = err.message || JSON.stringify(err);
    addLog({
      action: 'META_VERIFY',
      status: 'error',
      apiRequest: logRequest,
      apiResponse: JSON.stringify(err.raw || err),
      errorMessage: errMsg,
      statusCode: err.code
    });

    return {
      success: false,
      error: `Meta Error Code ${err.code || 'unknown'}: ${errMsg}`,
    };
  }
}

export async function uploadReelDirectBinary(
  config: MetaConfig,
  videoBuffer: Buffer,
  caption: string
): Promise<string> {
  const logRequest = `POST /${config.instagramBusinessAccountId}/media (upload_type=resumable)`;
  addLog({
    action: 'UPLOAD_REEL_RESUMABLE_START',
    status: 'info',
    apiRequest: `${logRequest} (file_size: ${videoBuffer.length} bytes, caption length: ${caption.length})`
  });

  try {
    // Step 1: Initialize resumable container session on graph.facebook.com
    const initData = await callMetaApi(
      config.graphApiVersion,
      `${config.instagramBusinessAccountId}/media`,
      'POST',
      {
        media_type: 'REELS',
        upload_type: 'resumable',
        caption: caption,
        share_to_feed: 'true'
      },
      config.accessToken
    );

    const containerId = initData.id;
    if (!containerId) {
      throw new Error(`Failed to obtain container ID from Meta API: ${JSON.stringify(initData)}`);
    }

    const version = config.graphApiVersion.startsWith('v') ? config.graphApiVersion : `v${config.graphApiVersion}`;
    const uploadUri = initData.uri || `https://rupload.facebook.com/ig-api-upload/${version}/${containerId}`;
    console.log(`[Meta] Resumable container created: ${containerId}. Uploading ${videoBuffer.length} bytes to ${uploadUri}...`);

    // Step 2: Upload binary video directly to rupload.facebook.com using Meta OAuth protocol
    const ruploadRes = await fetch(uploadUri, {
      method: 'POST',
      headers: {
        'Authorization': `OAuth ${config.accessToken}`,
        'offset': '0',
        'file_size': videoBuffer.length.toString(),
        'Content-Type': 'application/octet-stream',
        'Content-Length': videoBuffer.length.toString()
      },
      body: videoBuffer
    });

    const ruploadText = await ruploadRes.text();
    console.log(`[Meta] rupload response status: ${ruploadRes.status}, body: ${ruploadText.slice(0, 200)}`);

    if (!ruploadRes.ok) {
      throw new Error(`rupload.facebook.com transfer failed (HTTP ${ruploadRes.status}): ${ruploadText}`);
    }

    addLog({
      action: 'UPLOAD_REEL_RESUMABLE_SUCCESS',
      status: 'success',
      apiResponse: `Successfully uploaded binary (${(videoBuffer.length / (1024 * 1024)).toFixed(2)} MB) to Meta rupload for container ${containerId}`
    });

    return containerId;
  } catch (err: any) {
    const errMsg = err.message || JSON.stringify(err);
    addLog({
      action: 'UPLOAD_REEL_RESUMABLE_ERROR',
      status: 'error',
      apiRequest: logRequest,
      apiResponse: JSON.stringify(err.raw || err),
      errorMessage: errMsg,
      statusCode: err.code
    });
    throw err;
  }
}

export async function uploadReelContainer(
  config: MetaConfig,
  videoUrl: string,
  caption: string
): Promise<string> {
  const logRequest = `POST /${config.instagramBusinessAccountId}/media`;
  addLog({
    action: 'UPLOAD_REEL_CONTAINER',
    status: 'info',
    apiRequest: `${logRequest} (video_url: ${videoUrl}, caption length: ${caption.length})`
  });

  try {
    const data = await callMetaApi(
      config.graphApiVersion,
      `${config.instagramBusinessAccountId}/media`,
      'POST',
      {
        media_type: 'REELS',
        video_url: videoUrl,
        caption: caption,
        share_to_feed: 'true'
      },
      config.accessToken
    );

    addLog({
      action: 'UPLOAD_REEL_CONTAINER',
      status: 'success',
      apiResponse: JSON.stringify(data)
    });

    return data.id; // Container ID
  } catch (err: any) {
    const errMsg = err.message || JSON.stringify(err);
    addLog({
      action: 'UPLOAD_REEL_CONTAINER',
      status: 'error',
      apiRequest: logRequest,
      apiResponse: JSON.stringify(err.raw || err),
      errorMessage: errMsg,
      statusCode: err.code
    });
    throw err;
  }
}

export interface ContainerStatusResult {
  statusCode: 'FINISHED' | 'IN_PROGRESS' | 'ERROR' | 'EXPIRED' | 'UNKNOWN';
  status: string;
  errorMessage?: string;
}

export async function checkContainerStatus(
  config: MetaConfig,
  containerId: string
): Promise<ContainerStatusResult> {
  const logRequest = `GET /${containerId}?fields=status_code,status`;
  try {
    const data = await callMetaApi(
      config.graphApiVersion,
      containerId,
      'GET',
      { fields: 'status_code,status' },
      config.accessToken
    );

    const statusCode = data.status_code || 'UNKNOWN';
    const detailMsg = data.status ? `Container processing failed (${data.status})` : 'Container processing failed';

    // Log the container status check response for real-time audit verification
    addLog({
      action: 'META_CONTAINER_STATUS',
      status: statusCode === 'FINISHED' ? 'success' : statusCode === 'ERROR' || statusCode === 'EXPIRED' ? 'error' : 'info',
      apiRequest: logRequest,
      apiResponse: JSON.stringify(data),
      statusCode: statusCode === 'FINISHED' ? 200 : statusCode === 'ERROR' ? 500 : 202
    });

    return {
      statusCode,
      status: data.status || statusCode,
      errorMessage: statusCode === 'ERROR' ? detailMsg : undefined
    };
  } catch (err: any) {
    console.error('Failed to check container status:', err);
    addLog({
      action: 'META_CONTAINER_STATUS',
      status: 'error',
      apiRequest: logRequest,
      errorMessage: err.message || 'API call failed',
      apiResponse: JSON.stringify(err.raw || err)
    });
    return {
      statusCode: 'UNKNOWN',
      status: 'ERROR',
      errorMessage: err.message || 'API call failed'
    };
  }
}

export async function publishReel(
  config: MetaConfig,
  containerId: string
): Promise<string> {
  const logRequest = `POST /${config.instagramBusinessAccountId}/media_publish`;
  addLog({
    action: 'PUBLISH_REEL',
    status: 'info',
    apiRequest: `${logRequest} (creation_id: ${containerId})`
  });

  try {
    const data = await callMetaApi(
      config.graphApiVersion,
      `${config.instagramBusinessAccountId}/media_publish`,
      'POST',
      {
        creation_id: containerId
      },
      config.accessToken
    );

    addLog({
      action: 'PUBLISH_REEL',
      status: 'success',
      apiResponse: JSON.stringify(data)
    });

    return data.id; // Instagram Post ID
  } catch (err: any) {
    const errMsg = err.message || JSON.stringify(err);
    addLog({
      action: 'PUBLISH_REEL',
      status: 'error',
      apiRequest: logRequest,
      apiResponse: JSON.stringify(err.raw || err),
      errorMessage: errMsg,
      statusCode: err.code
    });
    throw err;
  }
}
