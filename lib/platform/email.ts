import nodemailer from 'nodemailer';
export async function sendEmail(to:string,subject:string,text:string){
 for(const key of ['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','MAIL_FROM'])if(!process.env[key])throw new Error(`Missing ${key}`);
 const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||465),secure:process.env.SMTP_SECURE!=='false',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}});
 await transport.sendMail({from:process.env.MAIL_FROM,to,subject,text});
}
