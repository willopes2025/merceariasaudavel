import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { DomainError } from './domain-error';

const FIELD_LABEL: Record<string, string> = { code: 'código', name: 'nome', email: 'e-mail', document: 'CPF/CNPJ', number: 'número', sku: 'código', barcode: 'código de barras', endpoint: 'aparelho' };

/** Formata todo erro no envelope único da API: { error: { code, message, details, traceId } }. */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const traceId = (request.headers['x-trace-id'] as string) ?? randomUUID();

    const { status, code, message, details } = this.describe(exception);
    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url} — ${message}`, (exception as Error)?.stack);
    }

    response.status(status).json({ error: { code, message, details, traceId } });
  }

  private describe(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof DomainError) {
      return {
        status: exception.httpStatus,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      const message = typeof payload === 'string' ? payload : ((payload as { message?: string }).message ?? exception.message);
      return {
        status: exception.getStatus(),
        code: this.httpCode(exception.getStatus()),
        message: Array.isArray(message) ? message.join('; ') : message,
        details: typeof payload === 'object' ? payload : undefined,
      };
    }
    // Cadastro repetido (código, nome, e-mail…): diz o que repetiu em vez de "erro interno".
    if ((exception as { code?: string } | null)?.code === 'P2002') {
      const target = (exception as { meta?: { target?: string[] | string } }).meta?.target;
      const fields = Array.isArray(target) ? target : String(target ?? '').split(/[_,]/);
      const label = [...new Set(fields.map((f) => FIELD_LABEL[f]).filter(Boolean))].join(', ');
      return { status: 409, code: 'DUPLICATE', message: label ? `Já existe um cadastro com este ${label}. Use outro.` : 'Já existe um cadastro igual a este.' };
    }
    return { status: 500, code: 'INTERNAL_ERROR', message: 'Erro interno' };
  }

  private httpCode(status: number): string {
    const codes: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE',
      429: 'TOO_MANY_REQUESTS',
    };
    return codes[status] ?? 'ERROR';
  }
}
