const test=require('node:test'),assert=require('node:assert/strict'),path=require('path'),Module=require('module'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{transformFileSync}=require('@babel/core');
const filename=path.resolve(__dirname,'../frontend/src/components/Workspace/WorkspaceImportIssues.js'),compiled=new Module(filename,module);
compiled.filename=filename;compiled.paths=Module._nodeModulePaths(path.dirname(filename));compiled._compile(transformFileSync(filename,{presets:['@babel/preset-env','@babel/preset-react']}).code,filename);
const Component=compiled.exports.default,{collectWorkspaceImportIssues}=require('../src/utils/workspaceImportIssues');
const base={objectNumber:'SYN',draftRowId:'SYN',included:true,year:null,expertiseType:'ug',comment:'',sourceIssues:[]};
test('Сводка объясняет причины вместо одного счётчика, показывает объекты и доступную фильтрацию',()=>{
 const summary=collectWorkspaceImportIssues([base],null),html=renderToStaticMarkup(React.createElement(Component,{summary,validation:{valid:false},onShowGroup(){},onShowAll(){}}));
 assert.match(html,/Причины ошибок импорта/);assert.match(html,/Укажите год от 1900 до 2100/);assert.match(html,/Например: SYN/);assert.match(html,/Показать объекты \(1\)/);assert.match(html,/tabindex="-1"/);
});
test('Имена и сообщения отображаются безопасным текстом, выбранная причина явно видна',()=>{
 const summary=collectWorkspaceImportIssues([{...base,objectNumber:'<img src=x onerror=alert(1)>',sourceIssues:[{code:'UNKNOWN_COLUMN',message:'Неизвестный столбец <script>SYN</script>'}]}],null);
 const html=renderToStaticMarkup(React.createElement(Component,{summary,activeGroup:summary.groups[0].key,onShowGroup(){},onShowAll(){}}));
 assert(!html.includes('<script>'));assert(!html.includes('<img'));assert.match(html,/&lt;script&gt;/);assert.match(html,/aria-pressed="true"/);assert.match(html,/Показать все объекты/);
});
