#!/usr/bin/env bun

import { Command } from "commander";
import {
  registerCancelCommand,
  registerDeployCommand,
  registerDustCommand,
  registerFundCommand,
  registerRegisterCommand,
  registerResultsCommand,
  registerWalletCommand,
} from "./commands";
import { registerPlanCommand } from "./commands/plan";
import { registerCompleteCommand } from "./commands/complete";
import { registerReceiptsCommand } from "./commands/receipts";
import { registerReadyCommand } from "./commands/ready";

const program = new Command()
  .name("accountun")
  .description("Tournament accounting CLI")
  .version("0.1.0");

registerDeployCommand(program);
registerWalletCommand(program);
registerDustCommand(program);
registerRegisterCommand(program);
registerFundCommand(program);
registerCancelCommand(program);
registerResultsCommand(program);
registerPlanCommand(program);
registerReadyCommand(program);
registerReceiptsCommand(program);
registerCompleteCommand(program);

program.helpCommand(true);

await program.parseAsync(process.argv);
