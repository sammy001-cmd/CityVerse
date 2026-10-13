export async function runStartup({critical,activate,firstFrame,optional=[],onFailure=()=>{}}) {
  await critical();activate();await firstFrame();
  const completion=Promise.allSettled(optional.map(job=>Promise.resolve().then(job).catch(error=>{onFailure(error);return null;})));
  return {completion};
}
