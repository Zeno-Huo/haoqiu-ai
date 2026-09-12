import { scf } from 'tencentcloud-sdk-nodejs-scf';
import { loadTencentCredentials } from './config';
import { ApiError } from './types';
export async function dispatchAnalysis(taskId: string) {
  const {SecretId,SecretKey,SecurityToken} = loadTencentCredentials();
  // SCF_/QCLOUD_/TENCENTCLOUD_ are reserved prefixes for cloud function environment
  // variables, so the VLM dispatch target uses its own prefix.
  const namespace = process.env.VLM_SCF_NAMESPACE;
  const functionName = process.env.VLM_SCF_FUNCTION;
  const token = process.env.VLM_WORKER_TOKEN;
  if (!namespace || !functionName || !token || !SecretId || !SecretKey) throw new ApiError(503,'CONFIGURATION_ERROR','SCF 异步触发配置缺失');
  const client = new scf.v20180416.Client({credential:{secretId:SecretId,secretKey:SecretKey,token:SecurityToken},region:process.env.COS_REGION || 'ap-shanghai',profile:{httpProfile:{reqTimeout:8}}});
  const response = await client.Invoke({FunctionName:functionName,Namespace:namespace,InvocationType:'Event',ClientContext:JSON.stringify({taskId,worker_token:token})});
  if (response.Result?.InvokeResult && response.Result.InvokeResult !== 0) throw new ApiError(503,'DISPATCH_FAILED','分析触发未被接受，任务等待恢复调度');
  return response.RequestId;
}
