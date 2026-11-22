import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * E-mail do sistema (rotinas do Assistente). Servidor SMTP pelo .env:
 * SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_FROM.
 * Sem SMTP_HOST, o envio é só simulado (e o Assistente avisa).
 */
@Injectable()
export class EmailService {
  private readonly log = new Logger('E-mail');
  private transporter: Transporter | null = null;

  get ligado() {
    return Boolean(process.env.SMTP_HOST?.trim());
  }

  private transporte(): Transporter {
    if (!this.transporter) {
      const port = Number(process.env.SMTP_PORT || 587);
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
    }
    return this.transporter;
  }

  async enviar(para: string, assunto: string, texto: string, anexos: { nome: string; conteudo: Buffer; mime: string }[] = []) {
    if (!this.ligado) {
      this.log.warn(`SMTP não configurado: e-mail para ${para} ("${assunto}") só simulado.`);
      return { simulado: true };
    }
    await this.transporte().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: para,
      subject: assunto,
      text: texto,
      attachments: anexos.map((a) => ({ filename: a.nome, content: a.conteudo, contentType: a.mime })),
    });
    return { simulado: false };
  }
}
