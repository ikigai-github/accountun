#!/usr/bin/env bun

import { Command } from "commander";
import {
  registerCancelCommand,
  registerDeployCommand,
  registerFundCommand,
  registerRegisterCommand,
  registerResultsCommand,
  registerWalletCommand,
} from "./commands";
import { registerPlanCommand } from "./commands/plan";
import { registerCompleteCommand } from "./commands/complete";
import { registerReceiptsCommand } from "./commands/receipts";

const program = new Command()
  .name("accountun")
  .description("Tournament accounting CLI")
  .version("0.1.0");

registerDeployCommand(program);
registerWalletCommand(program);
registerRegisterCommand(program);
registerFundCommand(program);
registerCancelCommand(program);
registerResultsCommand(program);
registerPlanCommand(program);
registerReceiptsCommand(program);
registerCompleteCommand(program);

program.helpCommand(true);

await program.parseAsync(process.argv);
