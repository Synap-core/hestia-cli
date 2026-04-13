import { Command } from 'commander'
import chalk from 'chalk'
import { EntityStateManager } from '@hestia/dna'

export function statusCommand(program: Command): void {
  program
    .command('status')
    .description('Show entity status')
    .action(async () => {
      try {
        const state = await EntityStateManager.getState()

        console.log(chalk.cyan('\n🌿 Entity Status\n'))

        // Display entity status with organ emojis
        if (state.brain) {
          console.log(chalk.yellow('🧠 Brain:'), state.brain.status)
        }
        if (state.heart) {
          console.log(chalk.red('❤️  Heart:'), state.heart.status)
        }
        if (state.lungs) {
          console.log(chalk.blue('🫁 Lungs:'), state.lungs.status)
        }
        if (state.hands) {
          console.log(chalk.green('🙌 Hands:'), state.hands.status)
        }
        if (state.legs) {
          console.log(chalk.magenta('🦵 Legs:'), state.legs.status)
        }
        if (state.skin) {
          console.log(chalk.cyan('🤚 Skin:'), state.skin.status)
        }

        console.log() // Empty line for spacing
      } catch (error) {
        console.error(chalk.red('Failed to get entity status:'), error)
        process.exit(1)
      }
    })
}