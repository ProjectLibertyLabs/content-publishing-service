export interface IPublisherJob {
    id: string;
    type: string;
    status: string;
    data: any;
    result: any;
    error: any;
    createdAt: Date;
    updatedAt: Date;
}
