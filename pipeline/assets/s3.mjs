import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {safePath,storageBase} from './ReleaseSchema.js';
export function s3Store(env=process.env){
  for(const key of ['WORLD_ASSET_S3_ENDPOINT','WORLD_ASSET_BUCKET','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY'])if(!env[key])throw Error(`Publishing requires ${key} in the environment`);
  const endpoint=storageBase(env.WORLD_ASSET_S3_ENDPOINT),prefix=env.WORLD_ASSET_PREFIX?`${safePath(env.WORLD_ASSET_PREFIX)}/`:'';
  const client=new S3Client({endpoint,region:env.WORLD_ASSET_REGION||env.AWS_REGION||'us-east-1',forcePathStyle:env.WORLD_ASSET_PATH_STYLE!=='false',credentials:{accessKeyId:env.AWS_ACCESS_KEY_ID,secretAccessKey:env.AWS_SECRET_ACCESS_KEY,sessionToken:env.AWS_SESSION_TOKEN},maxAttempts:3});
  return {
    async get(key){try{const r=await client.send(new GetObjectCommand({Bucket:env.WORLD_ASSET_BUCKET,Key:prefix+safePath(key)}));return {body:Buffer.from(await r.Body.transformToByteArray()),etag:r.ETag};}catch(e){if(e.$metadata?.httpStatusCode===404)return null;throw Error(`Storage GET failed for ${key}: ${e.name}`);}},
    async put(key,body,options){try{await client.send(new PutObjectCommand({Bucket:env.WORLD_ASSET_BUCKET,Key:prefix+safePath(key),Body:body,ContentType:'application/json',CacheControl:options.cacheControl,IfNoneMatch:options.immutable||!options.etag?'*':undefined,IfMatch:!options.immutable?options.etag:undefined,ChecksumSHA256:options.sha256?Buffer.from(options.sha256,'hex').toString('base64'):undefined}));}catch(e){const error=Error(`Storage PUT failed for ${key}: ${e.name}`);error.status=e.$metadata?.httpStatusCode;throw error;}},
    close(){client.destroy();}
  };
}
