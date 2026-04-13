#!/usr/bin/env node
import { Command } from 'commander'
import { initCommand } from '@hestia/brain'
import { statusCommand } from './commands/status.js'
import { doctorCommand } from './commands/doctor.js'
import { growCommand } from './commands/grow.js'

const program = new Command()

program
  .name('eve')
  .description('Eve - Entity Creation System')
  .version('0.1.0')

// Register organ commands
initCommand(program)

// Register entity commands
statusCommand(program)
doctorCommand(program)
growCommand(program)

program.parse()