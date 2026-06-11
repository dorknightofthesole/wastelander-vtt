/** Classic Foundry Dialog confirm (works reliably across v12/v13). */
export function scavengerConfirmDialog(
  title: string,
  content: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    new Dialog(
      {
        title,
        content: `<p>${content}</p>`,
        buttons: {
          yes: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("Yes"),
            callback: () => resolve(true),
          },
          no: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("No"),
            callback: () => resolve(false),
          },
        },
        default: "no",
        close: () => resolve(false),
      },
      { width: 420 },
    ).render(true);
  });
}
