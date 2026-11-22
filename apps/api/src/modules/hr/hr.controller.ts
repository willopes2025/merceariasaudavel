import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  PERMISSIONS,
  adjustmentSchema,
  clockPlaceSchema,
  employeeSchema,
  holidaySchema,
  hrConfigSchema,
  occurrenceSchema,
  payrollSchema,
  punchSchema,
  scheduleSchema,
  todayBR,
  type AdjustmentInput,
  type ClockPlaceInput,
  type EmployeeInput,
  type HrConfig,
  type OccurrenceInput,
  type PunchInput,
  type ScheduleInput,
} from '@mercearia/contracts';
import { Ctx, RequiresPermission } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/tenancy/request-context';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { HrService } from './hr.service';

const uuid = new ParseUUIDPipe();
const mes = (m?: string) => (m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : todayBR().slice(0, 7));
const closeSchema = payrollSchema;

/** Funcionários e ponto. Bater o ponto e "Meu ponto" valem para qualquer pessoa logada; o resto é da gestão. */
@Controller('hr')
export class HrController {
  constructor(private readonly hr: HrService) {}

  // ───── Para todos ─────

  @Post('clock/punch')
  punch(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(punchSchema)) d: PunchInput, @Req() req: Request) {
    return this.hr.punch(ctx, d, { ip: req.ip, device: req.headers['user-agent'] });
  }

  @Get('clock/me')
  me(@Ctx() ctx: RequestContext, @Query('month') month?: string) {
    return this.hr.me(ctx, mes(month));
  }

  @Post('clock/me/:month/ack')
  ack(@Ctx() ctx: RequestContext, @Param('month') month: string) {
    return this.hr.ack(ctx, mes(month));
  }

  @Get('clock/kiosk')
  kiosk(@Ctx() ctx: RequestContext) {
    return this.hr.kiosk(ctx);
  }

  // ───── Gestão ─────

  @Get('employees')
  @RequiresPermission(PERMISSIONS.hrManage)
  employees(@Ctx() ctx: RequestContext) {
    return this.hr.employees(ctx);
  }

  @Post('employees')
  @RequiresPermission(PERMISSIONS.hrManage)
  createEmployee(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(employeeSchema)) d: EmployeeInput) {
    return this.hr.saveEmployee(ctx, null, d);
  }

  @Put('employees/:id')
  @RequiresPermission(PERMISSIONS.hrManage)
  saveEmployee(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(employeeSchema)) d: EmployeeInput) {
    return this.hr.saveEmployee(ctx, id, d);
  }

  @Get('schedules')
  @RequiresPermission(PERMISSIONS.hrManage)
  schedules(@Ctx() ctx: RequestContext) {
    return this.hr.schedules(ctx);
  }

  @Post('schedules')
  @RequiresPermission(PERMISSIONS.hrManage)
  createSchedule(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(scheduleSchema)) d: ScheduleInput) {
    return this.hr.saveSchedule(ctx, null, d);
  }

  @Put('schedules/:id')
  @RequiresPermission(PERMISSIONS.hrManage)
  saveSchedule(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(scheduleSchema)) d: ScheduleInput) {
    return this.hr.saveSchedule(ctx, id, d);
  }

  @Get('places')
  @RequiresPermission(PERMISSIONS.hrManage)
  places(@Ctx() ctx: RequestContext) {
    return this.hr.places(ctx);
  }

  @Post('places')
  @RequiresPermission(PERMISSIONS.hrManage)
  createPlace(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(clockPlaceSchema)) d: ClockPlaceInput) {
    return this.hr.savePlace(ctx, null, d);
  }

  @Put('places/:id')
  @RequiresPermission(PERMISSIONS.hrManage)
  savePlace(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(clockPlaceSchema)) d: ClockPlaceInput) {
    return this.hr.savePlace(ctx, id, d);
  }

  @Get('config')
  @RequiresPermission(PERMISSIONS.hrManage)
  config(@Ctx() ctx: RequestContext) {
    return this.hr.config(ctx.tenantId);
  }

  @Put('config')
  @RequiresPermission(PERMISSIONS.hrManage)
  saveConfig(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(hrConfigSchema)) d: HrConfig) {
    return this.hr.saveConfig(ctx, d);
  }

  @Get('holidays')
  @RequiresPermission(PERMISSIONS.hrManage)
  holidays(@Ctx() ctx: RequestContext, @Query('year') year?: string) {
    const y = Number(year);
    return this.hr.holidays(ctx, y >= 2020 && y <= 2100 ? y : Number(todayBR().slice(0, 4)));
  }

  @Post('holidays')
  @RequiresPermission(PERMISSIONS.hrManage)
  saveHoliday(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(holidaySchema)) d: z.infer<typeof holidaySchema>) {
    return this.hr.saveHoliday(ctx, d);
  }

  @Delete('holidays/:id')
  @RequiresPermission(PERMISSIONS.hrManage)
  deleteHoliday(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.hr.deleteHoliday(ctx, id);
  }

  @Get('clock/today')
  @RequiresPermission(PERMISSIONS.hrManage)
  today(@Ctx() ctx: RequestContext) {
    return this.hr.today(ctx);
  }

  @Get('clock/summary')
  @RequiresPermission(PERMISSIONS.hrManage)
  summary(@Ctx() ctx: RequestContext, @Query('month') month?: string) {
    return this.hr.monthSummary(ctx, mes(month));
  }

  @Get('clock/mirror/:employeeId')
  @RequiresPermission(PERMISSIONS.hrManage)
  mirror(@Ctx() ctx: RequestContext, @Param('employeeId', uuid) id: string, @Query('month') month?: string) {
    return this.hr.mirror(ctx.tenantId, id, mes(month));
  }

  @Post('clock/adjustments')
  @RequiresPermission(PERMISSIONS.hrManage)
  adjust(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(adjustmentSchema)) d: AdjustmentInput) {
    return this.hr.adjust(ctx, d);
  }

  @Delete('clock/adjustments/:id')
  @RequiresPermission(PERMISSIONS.hrManage)
  deleteAdjustment(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.hr.deleteAdjustment(ctx, id);
  }

  @Get('clock/occurrences/:employeeId')
  @RequiresPermission(PERMISSIONS.hrManage)
  occurrences(@Ctx() ctx: RequestContext, @Param('employeeId', uuid) id: string) {
    return this.hr.occurrences(ctx, id);
  }

  @Post('clock/occurrences')
  @RequiresPermission(PERMISSIONS.hrManage)
  addOccurrence(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(occurrenceSchema)) d: OccurrenceInput) {
    return this.hr.addOccurrence(ctx, d);
  }

  @Delete('clock/occurrences/:id')
  @RequiresPermission(PERMISSIONS.hrManage)
  deleteOccurrence(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string) {
    return this.hr.deleteOccurrence(ctx, id);
  }

  @Post('clock/close')
  @RequiresPermission(PERMISSIONS.hrManage)
  close(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(closeSchema)) d: z.infer<typeof closeSchema>) {
    return this.hr.close(ctx, d.month, d.employeeIds);
  }

  @Get('clock/records/:id/photo')
  @RequiresPermission(PERMISSIONS.hrManage)
  async photo(@Ctx() ctx: RequestContext, @Param('id', uuid) id: string, @Res() res: Response) {
    const foto = await this.hr.photo(ctx, id);
    res.setHeader('content-type', 'image/jpeg');
    res.setHeader('cache-control', 'private, max-age=3600');
    res.setHeader('x-content-type-options', 'nosniff');
    res.send(foto);
  }

  /** Lança os salários do mês em contas a pagar. */
  @Post('payroll')
  @RequiresPermission(PERMISSIONS.hrManage, PERMISSIONS.financeManage)
  payroll(@Ctx() ctx: RequestContext, @Body(new ZodValidationPipe(payrollSchema)) d: z.infer<typeof payrollSchema>) {
    return this.hr.payroll(ctx, d.month, d.employeeIds);
  }
}
