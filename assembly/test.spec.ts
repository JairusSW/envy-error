describe("Console WASI Test", () => {
    test("Should log plain text", () => {
        process.stdout.write(":D");
    })
})