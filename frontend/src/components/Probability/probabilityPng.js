// Continuous report at A4 printable width (180 mm), at 96 logical DPI.
// Only server-confirmed values enter this layout; it never recalculates LR/PP.
const WIDTH=680, SCALE=2, FONT='Times New Roman';
function wrap(ctx,value,width){
  const lines=[];let line='';
  for(const word of String(value??'').split(/\s+/)){
    if(ctx.measureText(word).width>width){
      if(line){lines.push(line);line='';}
      for(const letter of word){if(ctx.measureText(line+letter).width>width){lines.push(line);line='';}line+=letter;}
    }else if(ctx.measureText(line?line+' '+word:word).width>width){lines.push(line);line=word;}
    else line=line?line+' '+word:word;
  }
  if(line)lines.push(line);return lines.length?lines:[''];
}
function font(ctx,size=12,bold=false,italic=false){ctx.font=(italic?'italic ':'')+(bold?'bold ':'')+size+'px '+FONT;}
function layout(report,ctx){
  font(ctx,14);const title=wrap(ctx,report.title,WIDTH-20),titleHeight=Math.max(62,title.length*17+24),bandHeight=24;
  let top=titleHeight+bandHeight;
  const metrics=report.summaryRows.map(metric=>{
    font(ctx,12);const label=wrap(ctx,metric.symbol?'('+metric.label+')':metric.label,WIDTH/2-(metric.symbol?84:14));
    const valueLines=metric.values.map(value=>wrap(ctx,value,WIDTH/2-24));
    const height=Math.max(metric.symbol?.includes('/')?48:30,Math.ceil((label.length*14+12)/metric.values.length),...valueLines.map(lines=>lines.length*14+10));
    const row={...metric,label,valueLines,height,y:top};top+=height*metric.values.length;return row;
  });
  const inputY=top;top+=bandHeight;
  const trio=report.mode==='TRIO';
  font(ctx,11);
  const sections=report.sections.map(section=>{
    const width=trio?WIDTH/2:WIDTH;
    const weights=trio?(section.id==='I'?[.24,.25,.51]:[.22,.17,.22,.17,.22]):[.17,.10,.10,.10,.29,.24];
    const widths=weights.map(w=>w*width);
    return {...section,width,widths,description:wrap(ctx,section.title,width-16)};
  });
  const descriptionHeight=Math.max(46,...sections.map(s=>s.description.length*14+14));top+=descriptionHeight;
  const upperHeight=trio?Math.max(52,...sections.flatMap(s=>s.alleleHeaders.map((text,i)=>wrap(ctx,text,s.widths[1+i*2]+s.widths[2+i*2]-12).length*13+12))):0;
  const lowerHeight=Math.max(30,...sections.flatMap(s=>s.columns.slice(trio?1:0).map((text,i)=>wrap(ctx,text,s.widths[i+(trio?1:0)]-8).length*13+10)));
  const headersY=top;top+=upperHeight+lowerHeight;
  font(ctx,10);
  const footerLines=[...report.participants.map(p=>p.role+': '+p.name),...report.footer].flatMap(text=>wrap(ctx,text,WIDTH-12));
  const footerHeight=footerLines.length*12+20;
  font(ctx,11);const entries=[];
  for(let i=0;i<Math.max(...sections.map(s=>s.rows.length),0);i++){
    const values=sections.map(s=>s.rows[i]||[]);
    const lines=sections.map((s,index)=>s.columns.map((_,j)=>wrap(ctx,values[index][j]||'',s.widths[j]-8)));
    const height=Math.max(22,...lines.flatMap(cells=>cells.map(cell=>cell.length*13+8)));
    entries.push({values,lines,height});
  }
  return {title,titleHeight,bandHeight,metrics,inputY,sections,descriptionHeight,headersY,upperHeight,lowerHeight,top,entries,footerLines,footerHeight};
}
export function reportView(report){
  const ctx=document.createElement('canvas').getContext('2d');if(!ctx)throw new Error('Браузер не поддерживает PNG.');
  const plan=layout(report,ctx);
  return {sections:plan.sections,layout:{descriptionHeight:plan.descriptionHeight,upperHeight:plan.upperHeight,lowerHeight:plan.lowerHeight}};
}
export async function reportPng(report){
  if(document.fonts?.ready)await document.fonts.ready;
  const canvas=document.createElement('canvas');canvas.width=WIDTH*SCALE;canvas.height=1;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Браузер не поддерживает PNG.');
  const plan=layout(report,ctx);
  const dataHeight=plan.entries.reduce((sum,e)=>sum+e.height,0);
  const contentHeight=Math.ceil(plan.top+dataHeight+plan.footerHeight+8);
  canvas.height=contentHeight*SCALE;ctx.scale(SCALE,SCALE);ctx.fillStyle='#fff';ctx.fillRect(0,0,WIDTH,contentHeight);
  function box(x,y,w,h,fill=false){if(fill){ctx.fillStyle='#e2e2d6';ctx.fillRect(x,y,w,h);}ctx.strokeStyle='#111';ctx.lineWidth=.65;ctx.strokeRect(x+.35,y+.35,w-.7,h-.7);ctx.fillStyle='#111';}
  function text(lines,x,y,w,h,{center=false,size=12,bold=false,italic=false}={}){
    font(ctx,size,bold,italic);const lineHeight=size+2,start=y+(h-lines.length*lineHeight)/2+size;
    lines.forEach((line,i)=>ctx.fillText(line,center?x+(w-ctx.measureText(line).width)/2:x+6,start+i*lineHeight));
  }
  function band(value,y){box(0,y,WIDTH,plan.bandHeight,true);text([value],0,y,WIDTH,plan.bandHeight,{center:true});}
  box(0,0,WIDTH,plan.titleHeight);text(plan.title,0,0,WIDTH,plan.titleHeight,{center:true,size:14});
  band(report.subtitle,plan.titleHeight);
  for(const metric of plan.metrics){
    const total=metric.height*metric.values.length;box(0,metric.y,WIDTH/2,total);
    if(metric.symbol){
      const parts=metric.symbol.split('/');
      if(parts.length===2){
        font(ctx,15,true,true);const w=40,x=11,mid=metric.y+total/2;
        text([parts[0]],x,mid-22,w,20,{center:true,size:15,italic:true});
        ctx.beginPath();ctx.moveTo(x,mid);ctx.lineTo(x+w,mid);ctx.stroke();
        text([parts[1]],x,mid+1,w,20,{center:true,size:15,italic:true});
      }else text([metric.symbol],7,metric.y,64,total,{center:true,size:15,italic:true});
    }
    text(metric.label,metric.symbol?76:0,metric.y,WIDTH/2-(metric.symbol?76:0),total);
    metric.values.forEach((value,i)=>{box(WIDTH/2,metric.y+i*metric.height,WIDTH/2,metric.height);text(metric.valueLines[i],WIDTH/2+6,metric.y+i*metric.height,WIDTH/2-6,metric.height,{bold:metric.emphasizeLast&&i===metric.values.length-1});});
  }
  band(report.inputTitle,plan.inputY);
  let x=0;const descY=plan.inputY+plan.bandHeight;
  plan.sections.forEach(section=>{
    box(x,descY,section.width,plan.descriptionHeight);text(section.description,x,descY,section.width,plan.descriptionHeight,{center:true,size:11});
    const hy=plan.headersY;
    if(report.mode==='TRIO'){
      box(x,hy,section.widths[0],plan.upperHeight+plan.lowerHeight);text(['Локус'],x,hy,section.widths[0],plan.upperHeight+plan.lowerHeight,{center:true,size:11});
      let columnX=x+section.widths[0];
      section.alleleHeaders.forEach((header,i)=>{const w=section.widths[1+i*2]+section.widths[2+i*2];font(ctx,11);const lines=wrap(ctx,header,w-12);box(columnX,hy,w,plan.upperHeight);text(lines,columnX,hy,w,plan.upperHeight,{center:true,size:11});columnX+=w;});
      columnX=x+section.widths[0];section.columns.slice(1).forEach((header,i)=>{const w=section.widths[i+1];font(ctx,11);const lines=wrap(ctx,header,w-8);box(columnX,hy+plan.upperHeight,w,plan.lowerHeight);text(lines,columnX,hy+plan.upperHeight,w,plan.lowerHeight,{center:true,size:11});columnX+=w;});
    }else{
      let columnX=x;section.columns.forEach((header,i)=>{const w=section.widths[i];font(ctx,11);box(columnX,hy,w,plan.lowerHeight);text(wrap(ctx,header,w-8),columnX,hy,w,plan.lowerHeight,{center:true,size:11});columnX+=w;});
    }
    x+=section.width;
  });
  let y=plan.top;
  plan.entries.forEach(entry=>{let sx=0;plan.sections.forEach((section,i)=>{let cx=sx;section.columns.forEach((_,j)=>{box(cx,y,section.widths[j],entry.height);text(entry.lines[i][j],cx,y,section.widths[j],entry.height,{center:j!==0,size:11});cx+=section.widths[j];});sx+=section.width;});y+=entry.height;});
  y+=16;font(ctx,10);plan.footerLines.forEach(line=>{ctx.fillText(line,6,y);y+=12;});
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Не удалось создать PNG.')),'image/png'));
}
export function downloadBlob(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
