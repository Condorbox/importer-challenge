import express, {Request, Response} from "express";

const app = express();

app.use(express.json());

app.get("/", (req: Request, res: Response) => {
    return res.send("Hello World");
});

app.post("/api/data", (req: Request, res: Response) => {
    console.log(req.body);

    return res.sendStatus(200);
});

app.all("/api/all", (req: Request, res: Response) => {
    return res.sendStatus(200);
});

app.listen(3000, () => {
    console.log("Aplication listening at http://localhost:3000");
});