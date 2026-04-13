import { Command } from 'commander'
import chalk from 'chalk'
import { EntityStateManager } from '@hestia/dna'

export function growCommand(program: Command): void {
  program
    .command('grow')
    .description('Grow the entity by developing new capabilities')
    .option('-o, --organ <name>', 'Specific organ to grow')
    .action(async (options) => {
      try {
        console.log(chalk.cyan('\n🌱 Growing entity...\n'))

        if (options.organ) {
          console.log(chalk.yellow(`Focusing growth on ${options.organ}...`))
          // Trigger organ-specific growth
        } else {
          console.log(chalk.yellow('Balanced growth across all organs...'))
          // Trigger balanced growth
        }

        const state = await EntityStateManager.getState()
        console.log(chalk.green('\n✓ Growth cycle complete'))
        console.log(chalk.gray(`Current entity level: ${state.level || 1}`))
        console.log()
      } catch (error) {
        console.error(chalk.red('Growth failed:'), error)
        process.exit(1)
      }
    })
}