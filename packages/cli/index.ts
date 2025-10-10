#!/usr/bin/env bun
import { Command, CommanderError } from "commander";
import {
  registerCancelCommand,
  registerDeployCommand,
  registerFundCommand,
  registerRegisterCommand,
  registerResultsCommand,
  registerWalletCommand,
} from "./commands";
import { registerPlanCommand } from "./commands/plan";

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

program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error: unknown) {
  if (error instanceof Error) {
    console.error(`✖ ${error.message}`);
    if (error.stack) console.error("\n" + error.stack);

    if (error instanceof CommanderError) {
      process.exit(error.exitCode);
    }
  } else {
    console.error(String(error));
  }

  process.exit(1);
}
