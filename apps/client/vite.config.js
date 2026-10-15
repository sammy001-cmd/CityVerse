import {defineConfig,loadEnv} from 'vite';
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {parseRelease} from '../../pipeline/assets/ReleaseSchema.js';
import {verifyRemote} from '../../pipeline/assets/delivery.mjs';
const clientRoot=fileURLToPath(new URL('.',import.meta.url)),root=path.resolve(clientRoot,'../..');
export default defineConfig(async({command,mode})=>{
  const release=parseRelease(JSON.parse(await fs.readFile(path.join(root,'world/release.json'),'utf8')));
  const env=loadEnv(mode,clientRoot,'VITE_'),baseURL=process.env.VITE_WORLD_ASSET_URL||env.VITE_WORLD_ASSET_URL;
  let localRelease='';
  if(command==='build'){
    if(!baseURL)throw Error('Production requires VITE_WORLD_ASSET_URL. Generated local world directories are never copied into production builds. Run assets:publish and configure the public storage root.');
    const result=await verifyRemote({release,baseURL});console.log(`World release verified: ${result.release}, ${result.verifiedFiles} files, ${result.verifiedBytes} bytes`);
  }else if(!baseURL){
    let state;try{state=JSON.parse(await fs.readFile(path.join(root,'.world-assets/local.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    if(state){if(state.release!==release.release||state.treeSHA256!==release.treeSHA256)throw Error('Local world release differs from the Git pin. Run npm run assets:sync.');localRelease=`/data/releases/${release.release}`;}
    else{
      let author;try{author=JSON.parse(await fs.readFile(path.join(root,'.world-assets/releases',release.release,'release.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
      if(author?.treeSHA256!==release.treeSHA256)throw Error('World assets are not synchronized. Run npm run assets:sync. World authors with generated source files can run npm run assets:create.');
      console.log(`World assets: validated author dataset ${release.release} at /data/.`);
    }
  }
  let resolved;
  return {
    define:{__WORLD_LOCAL_RELEASE__:JSON.stringify(localRelease)},
    build:{copyPublicDir:false},
    plugins:[{
      name:'cityverse-world-delivery',
      configResolved(config){resolved=config;},
      configureServer(server){const state=path.join(root,'.world-assets/local.json');server.watcher.add(state);server.watcher.on('change',file=>{if(file===state)void server.restart();});},
      async closeBundle(){
        if(command!=='build')return;
        const publicRoot=path.join(clientRoot,'public'),out=path.resolve(clientRoot,resolved.build.outDir);
        for(const name of await fs.readdir(publicRoot))if(name!=='data')await fs.cp(path.join(publicRoot,name),path.join(out,name),{recursive:true,force:true});
        await fs.writeFile(path.join(out,'world-release.json'),JSON.stringify(release));
      }
    }]
  };
});
