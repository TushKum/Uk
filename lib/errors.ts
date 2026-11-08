export class AppError extends Error{constructor(public status:number,public code:string,message:string){super(message);}}
export function requireRole(ok:unknown,message='Permission denied'):asserts ok{if(!ok)throw new AppError(403,'FORBIDDEN',message);}
