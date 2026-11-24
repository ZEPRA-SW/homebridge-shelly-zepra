'use strict';
// Standalone component fixtures use the same color scope as the Homebridge UI.
module.exports=async page=>page.evaluate(()=>{
 if(document.getElementById('zepra-app'))return;
 const root=document.createElement('div');root.id='zepra-app';root.dataset.zepraTheme='dark';
 root.append(...document.body.childNodes);document.body.append(root);
});
