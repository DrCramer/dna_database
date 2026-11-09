// Exact rational arithmetic over the finite decimals in FREQ. Only final values
// are converted to binary doubles; no frequency/likelihood epsilon or clamp.
function gcd(a,b){while(b){const r=a%b;a=b;b=r;}return a;}
function rational(n,d=1n){if(d===0n)throw new Error('Zero denominator');if(d<0n){n=-n;d=-d;}const g=gcd(n<0n?-n:n,d);return{n:n/g,d:d/g};}
function decimal(value){const [coefficient,e='0']=String(value).toLowerCase().split('e');const [whole,fraction='']=coefficient.split('.');const n=BigInt(whole+fraction),power=Number(e)-fraction.length;return power>=0?rational(n*10n**BigInt(power)):rational(n,10n**BigInt(-power));}
const add=(a,b)=>rational(a.n*b.d+b.n*a.d,a.d*b.d);
const sub=(a,b)=>rational(a.n*b.d-b.n*a.d,a.d*b.d);
const mul=(a,b)=>rational(a.n*b.n,a.d*b.d);
const div=(a,b)=>rational(a.n*b.d,a.d*b.n);
function number(a,digitsCount=17){
 if(a.n===0n)return 0;const negative=a.n<0n;const n=negative?-a.n:a.n,d=a.d;
 let exponent=n.toString().length-d.toString().length;
 if(exponent>=0?n<d*10n**BigInt(exponent):n*10n**BigInt(-exponent)<d)exponent--;
 const scale=digitsCount-1-exponent;const num=scale>=0?n*10n**BigInt(scale):n,den=scale>=0?d:d*10n**BigInt(-scale);
 const digits=(num*2n+den)/(2n*den);
 return Number(`${negative?'-':''}${digits}e${exponent-(digitsCount-1)}`);
}
function summary(mode,rows){
 const one=decimal(1),two=decimal(2),mu=decimal('0.001');let product=one;
 for(const row of rows){
  const [p,q]=row.frequencies.map(f=>decimal(f.value));let factor;
  if(mode==='IDENT')factor=q?mul(two,mul(p,q)):mul(p,p);
  else{
   const presence=a=>sub(mul(two,a),mul(a,a));
   const denominator=q?sub(add(presence(p),presence(q)),mul(two,mul(p,q))):presence(p);
   factor=row.mismatch?div(mu,sub(one,denominator)):div(sub(one,mu),denominator);
  }
  product=mul(product,factor);
 }
 const index=mode==='IDENT'?div(one,product):product,reciprocal=div(one,index);
 return{index:number(index),reciprocal:number(reciprocal),probability:number(div(index,add(one,index))),complement:number(div(one,add(one,index)))};
}
const roundForDisplay=value=>number(decimal(value),15);
module.exports={decimal,number,add,sub,mul,div,summary,roundForDisplay};
