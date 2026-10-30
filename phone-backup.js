
const backupPanel=document.createElement('article');backupPanel.className='card stack backup-panel';
const backupTitle=document.createElement('h2');backupTitle.textContent='手机资料备份';
const backupNote=document.createElement('p');backupNote.textContent='资料只在此浏览器保存，不自动同步。备份包含原件与个人资料，请自己保管。恢复会替换此浏览器的现有资料。';
const backupButton=document.createElement('button');backupButton.textContent='备份全部资料';
backupButton.onclick=async()=>{backupButton.disabled=true;try{const blob=await YimaiBrowser.backup();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='医脉手机版备份-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){document.getElementById('notice').textContent=e.message;}finally{backupButton.disabled=false;}};
const restoreLabel=document.createElement('label');restoreLabel.textContent='从备份恢复';
const restoreFile=document.createElement('input');restoreFile.type='file';restoreFile.accept='.json,application/json';restoreFile.setAttribute('aria-label','选择医脉备份文件');
restoreFile.onchange=async()=>{const file=restoreFile.files[0];if(!file)return;if(!confirm('恢复将替换当前浏览器的全部医脉资料。请先备份现有资料，是否继续？')){restoreFile.value='';return;}try{await YimaiBrowser.restore(file);}catch(e){document.getElementById('notice').textContent=e.message;restoreFile.value='';}};
backupPanel.append(backupTitle,backupNote,backupButton,restoreLabel,restoreFile);document.getElementById('center-view').append(backupPanel);
